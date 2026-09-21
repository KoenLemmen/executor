/** Owner purge over real SQL: every owned row goes, other owners are untouched. */
import { memoryBlobStore } from "@executor-js/sdk/blobs";
import assert from "node:assert/strict";
import { test } from "node:test";
import * as BrowserCrypto from "@effect/platform-browser/BrowserCrypto";
import { pgliteLayer } from "fumadb-effect/pglite";
import { Effect, Layer, Redacted, Schema } from "effect";
import {
  BuildId,
  OwnerId,
  OwnerWebhooksActive,
  WebhookId,
  createExecutor,
  makeExecutorStorage,
  runtimeAdapter,
  type ExecutorOptions,
  type Runtime,
} from "@executor-js/sdk/core";
import { aesGcmCredentials as credentials } from "@executor-js/sdk/core";

const alice = OwnerId.make("organization:alice");
const bob = OwnerId.make("organization:bob");
const files = [
  { path: "index.ts", content: "synthetic source handled by the supplied runtime" },
] as const;
const runtime: Runtime = {
  build: () =>
    Effect.succeed({
      build: BuildId.make("bld_fixture"),
      requirements: {
        accounts: {
          service: {
            cardinality: "one",
            definition: {
              name: "Synthetic",
              auth: {
                key: {
                  type: "secrets",
                  label: "API key",
                  fields: {
                    type: "object",
                    properties: { token: { type: "string" } },
                    required: ["token"],
                  },
                },
              },
            },
          },
        },
      },
    }),
  webhook: () => Effect.die("Unexpected webhook invocation"),
  inspect: () => Effect.succeed([]),
  query: () => Effect.succeed(null),
  mutate: () => Effect.succeed(null),
  call: () => Effect.succeed(null),
};

const fixture = Effect.gen(function* () {
  const storage = yield* makeExecutorStorage({ provider: "postgresql" });
  yield* storage.migrate;
  const credentialStore = yield* credentials(Redacted.make("ab".repeat(32)), crypto);
  return {
    blobs: memoryBlobStore(),
    storage,
    credentials: credentialStore,
    runtime: runtimeAdapter(runtime),
  } satisfies ExecutorOptions;
});
const services = Layer.mergeAll(BrowserCrypto.layer, pgliteLayer());

const populate = (executor: Effect.Success<ReturnType<typeof createExecutor>>, owner: OwnerId) =>
  Effect.gen(function* () {
    const { app } = yield* executor.apps.deploy({ owner, name: "Example", files });
    const requirement = app.requirements.accounts.service;
    assert.ok(requirement);
    const account = yield* executor.accounts.add({
      owner,
      provider: requirement.provider,
      method: "key",
      label: "Work",
      fields: Redacted.make({ token: "synthetic-token" }),
    });
    yield* executor.apps.update({ app: app.id, accounts: { service: account.id } });
    yield* executor.accountConnections.create({ owner, provider: requirement.provider });
    return { app, account };
  });

test(
  "removing an owner deletes its apps, accounts, deployments and connections",
  { timeout: 20_000 },
  () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const options = yield* fixture;
          const executor = yield* createExecutor(options);
          const db = options.storage.orm("1.8.2");
          const rows = (table: "deployments" | "accountConnections", owner: OwnerId) =>
            db.findMany(table, { select: ["id"], where: (b) => b("owner", "=", owner) });
          yield* populate(executor, alice);
          const theirs = yield* populate(executor, bob);

          const removed = yield* executor.owners.remove({ owner: alice });
          assert.deepEqual(removed, {
            owner: alice,
            apps: 1,
            accounts: 1,
            deployments: 1,
            connections: 1,
          });

          assert.deepEqual(yield* executor.apps.list({ owner: alice }), []);
          assert.deepEqual(yield* executor.accounts.list({ owner: alice }), []);
          // Retained code and the pending connection are deleted, not merely unreferenced.
          assert.deepEqual(yield* rows("deployments", alice), []);
          assert.deepEqual(yield* rows("accountConnections", alice), []);

          // A second owner's identical records survive an unrelated purge.
          assert.equal((yield* executor.apps.list({ owner: bob })).length, 1);
          assert.equal((yield* executor.accounts.list({ owner: bob })).length, 1);
          assert.equal((yield* executor.apps.deployments({ app: theirs.app.id })).length, 1);
          assert.equal((yield* rows("accountConnections", bob)).length, 1);

          // Repeating the purge is safe and reports nothing left to remove.
          assert.deepEqual(yield* executor.owners.remove({ owner: alice }), {
            owner: alice,
            apps: 0,
            accounts: 0,
            deployments: 0,
            connections: 0,
          });
        }).pipe(Effect.provide(services)),
      ),
    ),
);

test(
  "a live webhook subscription stops the purge and keeps every record",
  { timeout: 20_000 },
  () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const options = yield* fixture;
          const executor = yield* createExecutor(options);
          const mine = yield* populate(executor, alice);
          const db = options.storage.orm("1.8.2");
          // Stand in for a provider registration this owner still holds.
          yield* db.create("webhooks", {
            id: WebhookId.make("whk_live"),
            app: mine.app.id,
            owner: alice,
            key: "synthetic",
            deployment: mine.app.activeDeployment,
            name: "Synthetic",
            sourceAccount: mine.account.id,
            callbackUrl: "https://example.test/hook",
            accounts: {},
            status: "active",
            revision: "1",
            leaseUntil: new Date(0),
            failure: null,
            encrypted: new Uint8Array([1]),
            createdAt: new Date(0),
          });

          const failure = yield* Effect.flip(executor.owners.remove({ owner: alice }));
          assert.ok(Schema.is(OwnerWebhooksActive)(failure));
          assert.deepEqual(failure.subscriptions, ["whk_live"]);
          assert.equal((yield* executor.apps.list({ owner: alice })).length, 1);
          assert.equal((yield* executor.accounts.list({ owner: alice })).length, 1);
        }).pipe(Effect.provide(services)),
      ),
    ),
);
