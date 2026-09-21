/** Browser transport uses native Effect HTTP and Atom; authors receive Promise calls and atoms. */
import { browserSettings, makeBrowserTelemetry } from "@executor-js/telemetry/browser";
import { Effect, Layer, Schedule, Schema as EffectSchema, Stream } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { HttpApiClient } from "effect/unstable/httpapi";
import { AppUiApi, UiContext, UiFailed } from "../contracts/ui.ts";
import type { OperationReference } from "../contracts/live.ts";
import { JsonValue } from "../contracts/schema.ts";
import { decoderOf, type Schema } from "./schema.ts";

/** A scoped page client. Host-injected context carries only the deployment, never credentials. */
export const createAppClient = () => {
  const { runtime, atoms } = makeBrowserTelemetry(
    browserSettings("/_executor/api/telemetry", "executor-app-web"),
  );
  const browser = atoms(Layer.empty);
  const onHide = (event: PageTransitionEvent) => {
    if (!event.persisted) void dispose().catch((error) => console.error(error));
  };
  const dispose = async () => {
    window.removeEventListener("pagehide", onHide);
    await runtime.dispose();
  };
  window.addEventListener("pagehide", onHide);
  runtime.runFork(Effect.void);

  const context = Effect.try({
    try: () => document.getElementById("executor-context")?.textContent,
    catch: () => new UiFailed({ reason: "unavailable" }),
  }).pipe(Effect.flatMap(EffectSchema.decodeUnknownEffect(EffectSchema.fromJsonString(UiContext))));
  const client = HttpApiClient.make(AppUiApi).pipe(Effect.provide(FetchHttpClient.layer));
  const payload = (name: string, input: unknown) =>
    Effect.gen(function* () {
      return {
        ...(yield* context),
        name,
        input: yield* EffectSchema.decodeUnknownEffect(JsonValue)(input),
      };
    });
  const request = <Input, Output>(
    kind: "query" | "mutate",
    name: string,
    input: Input,
    output: Schema<Output, boolean>,
  ) =>
    Effect.gen(function* () {
      const api = yield* client;
      const value = yield* api.ui[kind]({ payload: yield* payload(name, input) });
      return yield* EffectSchema.decodeUnknownEffect(decoderOf(output))(value);
    }).pipe(Effect.withSpan(`ui.app.${kind}`, { attributes: { "executor.operation.name": name } }));
  return {
    /** Close this client when its page or embedding owner is removed. */
    dispose,
    /** Query only this app's server operations, with a runtime-validated response. */
    query: <Input, Output>(
      reference: OperationReference<Input, Output, "query">,
      input: NoInfer<Input>,
      output: Schema<NoInfer<Output>, boolean>,
    ) => runtime.runPromise(request("query", reference.name, input, output)),
    /** Mutations execute once; the transport never retries writes. */
    mutate: <Input, Output>(
      reference: OperationReference<Input, Output, "mutation">,
      input: NoInfer<Input>,
      output: Schema<NoInfer<Output>, boolean>,
    ) => runtime.runPromise(request("mutate", reference.name, input, output)),
    /** The atom owns its subscription and reconnects to current state after transport loss. */
    queryAtom: <Input, Output>(
      reference: OperationReference<Input, Output, "query">,
      input: NoInfer<Input>,
      output: Schema<NoInfer<Output>, boolean>,
    ) =>
      browser.atom(
        Stream.unwrap(
          Effect.gen(function* () {
            const api = yield* client;
            return yield* api.ui.subscribe({ payload: yield* payload(reference.name, input) });
          }).pipe(
            Effect.withSpan("ui.app.subscribe", {
              attributes: { "executor.operation.name": reference.name },
            }),
          ),
        ).pipe(
          Stream.timeout("45 seconds"),
          Stream.concat(Stream.fail(new UiFailed({ reason: "unavailable" }))),
          Stream.retry(
            Schedule.spaced("1 second").pipe(
              Schedule.while(
                ({ input }) =>
                  typeof input === "object" &&
                  input !== null &&
                  "_tag" in input &&
                  ["HttpClientError", "TimeoutError", "UiFailed"].includes(String(input._tag)),
              ),
            ),
          ),
          Stream.filter((frame) => frame.type !== "heartbeat"),
          Stream.mapEffect((frame) =>
            frame.type === "failure"
              ? Effect.fail(frame.error)
              : EffectSchema.decodeUnknownEffect(decoderOf(output))(frame.value).pipe(
                  Effect.mapError(() => new UiFailed({ reason: "operation_failed" })),
                ),
          ),
        ),
      ),
  };
};
