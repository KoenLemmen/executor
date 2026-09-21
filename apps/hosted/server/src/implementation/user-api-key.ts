/** Product-owned user keys. Deleting the user also removes the key's authority. */
import type { BetterAuthPlugin, GenericEndpointContext } from "@better-auth/core";
import { APIError, createAuthEndpoint, getSessionFromCtx } from "better-auth/api";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { authCall, runAuth } from "@executor-js/mcp-auth/oauth";
import { Effect, Encoding, Redacted, Schema } from "effect";

/** Distinguish managed user keys from OAuth access tokens without an authentication fallback. */
export const userApiKeyPrefix = "exu_";
const Key = Schema.String.check(Schema.isPattern(/^exu_[A-Za-z0-9_-]{43}$/));
const Stored = Schema.Struct({
  id: Schema.NonEmptyString,
  executorApiKeyHash: Schema.NullOr(Schema.NonEmptyString),
  executorApiKeyEncrypted: Schema.NullOr(Schema.NonEmptyString),
});
const parseStored = (value: unknown) =>
  value === null
    ? Effect.fail(new APIError("UNAUTHORIZED"))
    : Schema.decodeUnknownEffect(Stored)(value).pipe(
        Effect.mapError(() => new APIError("SERVICE_UNAVAILABLE")),
      );
const digest = (key: Redacted.Redacted<string>) =>
  authCall(async () =>
    Encoding.encodeHex(
      new Uint8Array(
        await globalThis.crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(Redacted.value(key)),
        ),
      ),
    ),
  );

const ensureKey = (ctx: GenericEndpointContext, userId: string) =>
  Effect.gen(function* () {
    const read = authCall(() =>
      ctx.context.adapter.findOne({
        model: "user",
        where: [{ field: "id", value: userId }],
        select: ["id", "executorApiKeyHash", "executorApiKeyEncrypted"],
      }),
    ).pipe(Effect.flatMap(parseStored));
    const stored = yield* read;
    if ((stored.executorApiKeyHash === null) !== (stored.executorApiKeyEncrypted === null))
      return yield* Effect.fail(new APIError("SERVICE_UNAVAILABLE"));
    if (stored.executorApiKeyHash === null) {
      const key = yield* Effect.try({
        try: () =>
          Redacted.make(
            userApiKeyPrefix +
              Encoding.encodeBase64Url(globalThis.crypto.getRandomValues(new Uint8Array(32))),
          ),
        catch: () => new APIError("SERVICE_UNAVAILABLE"),
      });
      const hash = yield* digest(key);
      const encrypted = yield* authCall(() =>
        symmetricEncrypt({ key: ctx.context.secretConfig, data: Redacted.value(key) }),
      );
      // Compare-and-set publishes both fields together. Concurrent callers reuse the winner's key.
      yield* authCall(() =>
        ctx.context.adapter.updateMany({
          model: "user",
          where: [
            { field: "id", value: userId },
            { field: "executorApiKeyHash", value: null },
            { field: "executorApiKeyEncrypted", value: null },
          ],
          update: { executorApiKeyHash: hash, executorApiKeyEncrypted: encrypted },
        }),
      );
    }
    const current = yield* read;
    if (current.executorApiKeyHash === null || current.executorApiKeyEncrypted === null)
      return yield* Effect.fail(new APIError("SERVICE_UNAVAILABLE"));
    const encrypted = current.executorApiKeyEncrypted;
    const key = yield* authCall(() =>
      symmetricDecrypt({ key: ctx.context.secretConfig, data: encrypted }),
    ).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.RedactedFromValue(Key))),
      Effect.mapError(() => new APIError("SERVICE_UNAVAILABLE")),
    );
    if ((yield* digest(key)) !== current.executorApiKeyHash)
      return yield* Effect.fail(new APIError("SERVICE_UNAVAILABLE"));
    return { key };
  });

/** Resolve only a currently existing user. Keys have no separate expiry or revocation lifecycle. */
export const apiKeyUser = (ctx: GenericEndpointContext, token: Redacted.Redacted<string>) =>
  Effect.gen(function* () {
    const key = yield* Schema.decodeUnknownEffect(Schema.RedactedFromValue(Key))(
      Redacted.value(token),
    ).pipe(Effect.mapError(() => new APIError("UNAUTHORIZED")));
    const hash = yield* digest(key);
    const user = yield* authCall(() =>
      ctx.context.adapter.findOne({
        model: "user",
        where: [{ field: "executorApiKeyHash", value: hash }],
        select: ["id"],
      }),
    );
    return yield* Schema.decodeUnknownEffect(Schema.Struct({ id: Schema.NonEmptyString }))(
      user,
    ).pipe(
      Effect.mapError(() => new APIError("UNAUTHORIZED")),
      Effect.map((user) => user.id),
    );
  });

/** Add private nullable user fields and a same-origin, session-authenticated creation endpoint. */
export const userApiKeyPlugin = (origin: string) =>
  ({
    id: "executor-user-api-key",
    schema: {
      user: {
        fields: {
          executorApiKeyHash: {
            type: "string",
            required: false,
            input: false,
            returned: false,
            unique: true,
          },
          executorApiKeyEncrypted: {
            type: "string",
            required: false,
            input: false,
            returned: false,
          },
        },
      },
    },
    endpoints: {
      ensureExecutorApiKey: createAuthEndpoint(
        "/executor/api-key",
        {
          method: "POST",
          requireHeaders: true,
          body: Schema.toStandardSchemaV1(Schema.Struct({})),
        },
        (ctx) =>
          runAuth(
            Effect.gen(function* () {
              if (ctx.headers.has("authorization") || ctx.headers.get("origin") !== origin)
                return yield* Effect.fail(new APIError("FORBIDDEN"));
              const session = yield* authCall(() =>
                getSessionFromCtx(ctx, { disableCookieCache: true }),
              );
              if (session === null) return yield* Effect.fail(new APIError("UNAUTHORIZED"));
              const result = yield* ensureKey(ctx, session.user.id);
              ctx.setHeader("cache-control", "no-store");
              return ctx.json({ key: Redacted.value(result.key) });
            }),
          ),
      ),
    },
  }) satisfies BetterAuthPlugin;
