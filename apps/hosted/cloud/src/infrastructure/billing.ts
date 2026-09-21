/** Test stages get a private Autumn emulator instance instead of the shared configured one. */
import { Random } from "alchemy";
import * as Output from "alchemy/Output";
import { CurrentRuntimeContext } from "alchemy/RuntimeContext";
import { Stage } from "alchemy/Stage";
import { BillingCatalog } from "../contracts/billing-catalog.ts";
import { Config, Effect, Option, Redacted, Schema } from "effect";
import { testStage } from "./stage.ts";
import { cloudEmulators } from "./emulators.ts";

export interface BillingSettings {
  readonly mode: "emulator" | "sandbox" | "live";
  readonly catalog: Effect.Effect<BillingCatalog | null>;
  /** Autumn emulator base URL. Treated as a capability, like a credential. */
  readonly serverUrl: Effect.Effect<Redacted.Redacted<string>>;
  /** Autumn bearer key. The emulator does not validate it. */
  readonly secretKey: Effect.Effect<Redacted.Redacted<string>>;
}

/**
 * Configured stages read both values from their environment at deploy time.
 * Test stages mint a random instance path and secret instead; the emulator
 * creates the instance lazily on first use, so nothing needs provisioning.
 */
export const billingSettings = Effect.gen(function* () {
  const emulators = yield* cloudEmulators;
  if (Option.isSome(emulators)) {
    const { billing } = Redacted.value(emulators.value);
    return {
      mode: "emulator",
      catalog: Effect.succeed(null),
      serverUrl: Effect.succeed(Redacted.make(billing.baseUrl)),
      secretKey: Effect.succeed(Redacted.make(billing.token)),
    } satisfies BillingSettings;
  }
  const mode = yield* Config.Literals(["emulator", "sandbox", "live"], "BILLING_MODE").pipe(
    Config.withDefault("emulator"),
  );
  if (mode !== "emulator") {
    const key = yield* Config.Redacted("AUTUMN_SECRET_KEY");
    if (!Redacted.value(key).startsWith(mode === "sandbox" ? "am_sk_test_" : "am_sk_live_"))
      return yield* Effect.die("Autumn credential does not match BILLING_MODE");
    const context = yield* CurrentRuntimeContext;
    if (context === undefined)
      return yield* Effect.die("Billing requires an Alchemy runtime context");
    return {
      mode,
      secretKey: Effect.succeed(key),
      serverUrl: Effect.succeed(Redacted.make("https://api.useautumn.com")),
      catalog: Effect.gen(function* () {
        const value = yield* context.get<unknown>("EXECUTOR_BILLING_CATALOG");
        const catalog = yield* (
          typeof value === "string"
            ? Schema.decodeUnknownEffect(Schema.fromJsonString(BillingCatalog))(value)
            : Schema.decodeUnknownEffect(BillingCatalog)(value)
        ).pipe(Effect.orDie);
        if (catalog.environment !== mode)
          return yield* Effect.die("Billing catalog environment mismatch");
        return catalog;
      }),
    } satisfies BillingSettings;
  }
  const stage = yield* testStage;
  if (Option.isNone(stage)) {
    const secretKey = yield* Config.Redacted("AUTUMN_SECRET_KEY");
    const serverUrl = yield* Config.Redacted("AUTUMN_EMULATOR_URL");
    return {
      mode,
      catalog: Effect.succeed(null),
      serverUrl: Effect.succeed(serverUrl),
      secretKey: Effect.succeed(secretKey),
    } satisfies BillingSettings;
  }
  const { slug } = stage.value;
  const host = yield* Config.String("TEST_STAGE_EMULATOR_HOST").pipe(
    Config.withDefault("https://emulators.dev"),
  );
  const instance = yield* Random("BillingInstance", { bytes: 12 });
  const secret = yield* Random("BillingSecret");
  const serverUrl = (yield* instance.text).pipe(
    Effect.map((hex) =>
      Redacted.make(`${host}/autumn/executor-next-${slug}-${Redacted.value(hex)}`),
    ),
  );
  return {
    mode,
    catalog: Effect.succeed(null),
    serverUrl,
    secretKey: yield* secret.text,
  } satisfies BillingSettings;
});

/** Live catalogs use a separate stage so sandbox state and subscriptions stay intact. */
export const billingBindings = Effect.gen(function* () {
  if (Option.isSome(yield* cloudEmulators.pipe(Effect.orDie))) return {};
  const mode = yield* Config.Literals(["emulator", "sandbox", "live"], "BILLING_MODE").pipe(
    Config.withDefault("emulator"),
  );
  if (mode === "emulator") return {};
  const stage = yield* Stage;
  const catalog = yield* Output.stackRef<BillingCatalog>("executor-next-billing", {
    stage: mode === "live" ? `${stage}-live` : stage,
  });
  return {
    EXECUTOR_BILLING_CATALOG: catalog.pipe(
      Output.map((value) => {
        if (value.environment !== mode)
          throw new Error("Deploy the billing catalog for the selected environment first");
        return JSON.stringify(value);
      }),
    ),
  };
});
