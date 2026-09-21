import { memorySourceStorage } from "@executor-js/sdk/testing";
/** Stateless live queries must not allocate a cloud storage notification channel. */
import assert from "node:assert/strict";
import { test } from "node:test";
import * as BrowserCrypto from "@effect/platform-browser/BrowserCrypto";
import { Effect, Layer, Redacted, Stream } from "effect";
import { pgliteLayer } from "fumadb-effect/pglite";
import { memoryBlobStore } from "@executor-js/sdk/blobs";
import {
  aesGcmCredentials,
  BuildId,
  createExecutor,
  makeExecutorStorage,
  OwnerId,
  runtimeAdapter,
} from "@executor-js/sdk/core";

for (const database of [undefined, {}]) {
  test(`live query allocates a storage feed only for a declared database (${database !== undefined})`, () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const storage = yield* makeExecutorStorage({ provider: "postgresql" });
          yield* storage.migrate;
          const credentials = yield* aesGcmCredentials(Redacted.make("ab".repeat(32)), crypto);
          const observed: string[] = [];
          const executor = yield* createExecutor({
            storage,
            sources: memorySourceStorage(),
            credentials,
            blobs: memoryBlobStore(),
            runtime: runtimeAdapter({
              build: () =>
                Effect.succeed({
                  build: BuildId.make("bld_fixture"),
                  requirements: { accounts: {}, ...(database === undefined ? {} : { database }) },
                }),
              workflow: () => Effect.die("Unexpected workflow invocation"),
              webhook: () => Effect.die("Unexpected webhook invocation"),
              inspect: () => Effect.succeed([]),
              call: () => Effect.succeed(null),
              mutate: () => Effect.succeed(null),
              query: () => Effect.succeed("fresh"),
              changes: (app) =>
                Stream.sync(() => {
                  observed.push(app);
                }),
            }),
          });
          const { app } = yield* executor.apps.deploy({
            owner: OwnerId.make("fixture"),
            name: "Fixture",
            files: [{ path: "index.ts", content: "Synthetic runtime" }],
          });
          const stream = yield* executor.appData.subscribe({
            app: app.id,
            name: "query",
            input: {},
          });
          const values = yield* Stream.runCollect(Stream.take(stream, 1));
          assert.equal(values[0]?.value, "fresh");
          assert.deepEqual(observed, database === undefined ? [] : [app.id]);
        }),
      ).pipe(Effect.provide(Layer.mergeAll(BrowserCrypto.layer, pgliteLayer()))),
    ));
}
