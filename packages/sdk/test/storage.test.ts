/** Real SQL checks for the tracked ORM and native transaction boundary. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { pgliteLayer } from "fumadb-effect/pglite";
import { Deferred, Effect, Fiber, Option, Schema, Stream } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { sqlAdapter } from "fumadb-effect/sql";
import {
  AppSlug,
  WebhookId,
  AccountConnectionId,
  AccountId,
  AppId,
  AppCodeId,
  BuildId,
  DeploymentId,
  OwnerId,
  ProviderId,
  executorDatabase,
  makeExecutorStorage,
} from "../src/index.ts";

const withStorage = <A, E>(
  work: (
    storage: Effect.Success<ReturnType<typeof makeExecutorStorage>>,
  ) => Effect.Effect<A, E, SqlClient.SqlClient>,
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const storage = yield* makeExecutorStorage({ provider: "postgresql" });
        yield* storage.migrate;
        return yield* work(storage);
      }).pipe(Effect.provide(pgliteLayer())),
    ),
  );

const provider = ProviderId.make("prv_test");
const account = {
  id: AccountId.make("acc_test"),
  owner: OwnerId.make("alice"),
  provider,
  method: "key",
  label: "Work",
  encryptedCredentials: new Uint8Array([1, 2, 3]),
  createdAt: new Date(0),
};

test("real SQL rollback and cancellation leave no rows or live notification", () =>
  withStorage((storage) =>
    Effect.gen(function* () {
      const db = storage.orm("1.9.0");
      const initial = yield* Deferred.make<void>();
      const rows: number[] = [];
      const subscriber = yield* storage.reactivity.subscribe(db.count("providers")).pipe(
        Stream.take(2),
        Stream.runForEach(({ value }) =>
          Effect.gen(function* () {
            rows.push(value);
            yield* Deferred.succeed(initial, undefined);
          }),
        ),
        Effect.forkChild,
      );
      yield* Deferred.await(initial);
      yield* db
        .transaction(
          Effect.gen(function* () {
            yield* db.create("providers", { id: provider, definition: {} });
            return yield* Effect.fail("rollback");
          }),
        )
        .pipe(Effect.result);
      assert.equal(yield* db.count("providers"), 0);
      const inserted = yield* Deferred.make<void>();
      const cancelled = yield* db
        .transaction(
          Effect.gen(function* () {
            yield* db.create("providers", { id: provider, definition: {} });
            yield* Deferred.succeed(inserted, undefined);
            yield* Effect.never;
          }),
        )
        .pipe(Effect.forkChild);
      yield* Deferred.await(inserted);
      yield* Fiber.interrupt(cancelled);
      assert.equal(yield* db.count("providers"), 0);
      yield* db.create("providers", { id: provider, definition: {} });
      yield* Fiber.join(subscriber);
      assert.deepEqual(rows, [0, 1]);
    }),
  ));

test("joined and empty reads observe related table writes", () =>
  withStorage((storage) =>
    Effect.gen(function* () {
      const db = storage.orm("1.9.0");
      yield* db.create("providers", { id: provider, definition: { name: "Before" } });
      yield* db.create("accounts", account);
      const ready = yield* Deferred.make<void>();
      const definitions: unknown[] = [];
      const subscriber = yield* storage.reactivity
        .subscribe(db.findMany("accounts", { join: (b) => b.providerDefinition() }))
        .pipe(
          Stream.take(2),
          Stream.runForEach(({ value }) =>
            Effect.gen(function* () {
              definitions.push(value[0]?.providerDefinition?.definition);
              yield* Deferred.succeed(ready, undefined);
            }),
          ),
          Effect.forkChild,
        );
      yield* Deferred.await(ready);
      yield* db.updateMany("providers", {
        where: (b) => b("id", "=", provider),
        set: { definition: { name: "After" } },
      });
      yield* Fiber.join(subscriber);
      assert.deepEqual(definitions, [{ name: "Before" }, { name: "After" }]);
    }),
  ));

test("an untracked outer SQL transaction is rejected before a tracked write", () =>
  withStorage((storage) =>
    Effect.gen(function* () {
      const db = storage.orm("1.9.0");
      const sql = yield* SqlClient.SqlClient;
      const result = yield* sql
        .withTransaction(db.create("providers", { id: provider, definition: {} }))
        .pipe(Effect.result);
      assert.equal(result._tag, "Failure");
      assert.equal(yield* db.count("providers"), 0);
    }),
  ));

test("connection migration preserves existing accounts, grants, deployments and selections", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = executorDatabase.client(sqlAdapter({ provider: "postgresql" }));
        const migrator = yield* client.createMigrator;
        yield* (yield* migrator.migrateTo("1.2.0")).execute;
        const old = client.orm("1.2.0");
        yield* old.create("providers", { id: provider, definition: { name: "Synthetic" } });
        yield* old.create("accounts", account);
        const grant = {
          id: account.id,
          encrypted: new Uint8Array([4, 5, 6]),
          status: "ready_test",
          updatedAt: new Date(0),
        };
        yield* old.create("oauthGrants", grant);
        const deployment = {
          id: DeploymentId.make("dpl_existing"),
          code: AppCodeId.make("code_existing"),
          owner: account.owner,
          files: [{ path: "index.ts", content: "synthetic source" }],
          build: BuildId.make("bld_existing"),
          requirements: { accounts: {} },
          createdAt: new Date(0),
        };
        yield* old.create("deployments", deployment);
        const app = {
          id: AppId.make("app_existing"),
          code: deployment.code,
          owner: account.owner,
          name: "Existing",
          activeDeployment: deployment.id,
          accounts: { synthetic: account.id },
          createdAt: new Date(0),
        };
        yield* old.create("apps", app);
        const collision = { ...app, id: AppId.make("app_existing2"), name: "Second existing" };
        yield* old.create("apps", collision);
        yield* (yield* migrator.migrateTo("1.3.0")).execute;
        const pending = {
          id: AccountConnectionId.make("con_pending"),
          owner: account.owner,
          provider,
          reconnectAccount: account.id,
          state: { status: "pending" },
          revision: "initial",
          oauthAttempt: "oauth_pending",
          createdAt: new Date(0),
          expiresAt: new Date(60_000),
        };
        yield* client.orm("1.3.0").create("accountConnections", pending);
        const storage = yield* makeExecutorStorage({ provider: "postgresql" });
        yield* storage.migrate;
        const current = storage.orm("1.9.0");
        assert.deepEqual(yield* current.findMany("toolApprovals", {}), []);
        assert.deepEqual(yield* current.findMany("accounts", {}), [account]);
        assert.deepEqual(yield* current.findMany("oauthGrants", {}), [grant]);
        assert.deepEqual(yield* current.findMany("deployments", {}), [deployment]);
        assert.deepEqual(yield* current.findMany("apps", { orderBy: ["id", "asc"] }), [
          { ...app, slug: "existing" },
          { ...collision, slug: "second-existing" },
        ]);
        assert.deepEqual(yield* current.findMany("accountConnections", {}), [
          { ...pending, target: null },
        ]);
      }),
    ).pipe(Effect.provide(pgliteLayer())),
  ));

for (const version of ["1.5.0", "1.7.0", "1.8.0"] as const) {
  test(`name-derived slug migration rejects collisions from ${version} without changing stored data`, () =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { AppSlugTaken } = yield* Effect.promise(() => import("../src/core.ts"));
          const client = executorDatabase.client(sqlAdapter({ provider: "postgresql" }));
          const migrator = yield* client.createMigrator;
          yield* (yield* migrator.migrateTo(version)).execute;
          const rows = [
            { id: AppId.make("app_one"), name: "Support Inbox", slug: "custom-one" },
            { id: AppId.make("app_two"), name: "Support-Inbox", slug: "custom-two" },
          ];
          const deployment = {
            id: DeploymentId.make("dpl_old"),
            code: AppCodeId.make("code_old"),
            owner: OwnerId.make("owner"),
            files: [],
            build: BuildId.make("bld_old"),
            requirements: { accounts: {} },
            createdAt: new Date(0),
          };
          yield* client.orm(version).create("deployments", deployment);
          for (const row of rows) {
            const value = {
              id: row.id,
              name: row.name,
              code: deployment.code,
              owner: deployment.owner,
              activeDeployment: deployment.id,
              accounts: {},
              createdAt: new Date(0),
            };
            if (version === "1.5.0") yield* client.orm("1.5.0").create("apps", value);
            else
              yield* client.orm(version).create("apps", { ...value, slug: AppSlug.make(row.slug) });
          }
          const before = yield* client.orm(version).findMany("apps", { orderBy: ["id", "asc"] });
          const storage = yield* makeExecutorStorage({ provider: "postgresql" });
          const error = yield* storage.migrate.pipe(Effect.flip);
          assert.ok(Schema.is(AppSlugTaken)(error));
          assert.equal(error.slug, "support-inbox");
          assert.deepEqual(
            yield* client.orm(version).findMany("apps", { orderBy: ["id", "asc"] }),
            before,
          );
          assert.deepEqual(yield* migrator.version, Option.some(version));
        }),
      ).pipe(Effect.provide(pgliteLayer())),
    ));
}

test("name-derived migration replaces custom slugs atomically, including swapped keys", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = executorDatabase.client(sqlAdapter({ provider: "postgresql" }));
        const migrator = yield* client.createMigrator;
        yield* (yield* migrator.migrateTo("1.7.0")).execute;
        const old = client.orm("1.7.0");
        const deployment = {
          id: DeploymentId.make("dpl_old"),
          code: AppCodeId.make("code_old"),
          owner: OwnerId.make("owner"),
          files: [],
          build: BuildId.make("bld_old"),
          requirements: { accounts: {} },
          createdAt: new Date(0),
        };
        yield* old.create("deployments", deployment);
        const common = {
          code: deployment.code,
          owner: deployment.owner,
          activeDeployment: deployment.id,
          accounts: {},
          createdAt: new Date(0),
        };
        const a = {
          ...common,
          id: AppId.make("app_one"),
          name: "Alpha",
          slug: AppSlug.make("beta"),
        };
        const b = {
          ...common,
          id: AppId.make("app_two"),
          name: "Beta",
          slug: AppSlug.make("alpha"),
        };
        yield* old.create("apps", a);
        yield* old.create("apps", b);
        const storage = yield* makeExecutorStorage({ provider: "postgresql" });
        yield* storage.migrate;
        yield* storage.migrate;
        assert.deepEqual(yield* storage.orm("1.9.0").findMany("apps", { orderBy: ["id", "asc"] }), [
          { ...a, slug: AppSlug.make("alpha") },
          { ...b, slug: AppSlug.make("beta") },
        ]);
        assert.deepEqual(yield* migrator.version, Option.some("1.9.0"));
      }),
    ).pipe(Effect.provide(pgliteLayer())),
  ));

test("webhook migration adds lifecycle tables without changing existing credentials", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = executorDatabase.client(sqlAdapter({ provider: "postgresql" }));
        const migrator = yield* client.createMigrator;
        yield* (yield* migrator.migrateTo("1.7.0")).execute;
        const previous = client.orm("1.7.0");
        yield* previous.create("providers", { id: provider, definition: {} });
        yield* previous.create("accounts", account);
        const storage = yield* makeExecutorStorage({ provider: "postgresql" });
        yield* storage.migrate;
        assert.deepEqual(yield* storage.orm("1.9.0").findMany("accounts", {}), [account]);
        assert.deepEqual(yield* storage.orm("1.9.0").findMany("webhooks", {}), []);
        assert.deepEqual(yield* storage.orm("1.9.0").findMany("webhookAccounts", {}), []);
      }),
    ).pipe(Effect.provide(pgliteLayer())),
  ));

test("re-deriving old webhook-era slugs preserves subscriptions, ciphertext and account references", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = executorDatabase.client(sqlAdapter({ provider: "postgresql" }));
        const migrator = yield* client.createMigrator;
        yield* (yield* migrator.migrateTo("1.8.0")).execute;
        const old = client.orm("1.8.0");
        yield* old.create("providers", { id: provider, definition: {} });
        yield* old.create("accounts", account);
        const deployment = {
          id: DeploymentId.make("dpl_webhook"),
          code: AppCodeId.make("code_webhook"),
          owner: account.owner,
          files: [],
          build: BuildId.make("bld_webhook"),
          requirements: { accounts: {} },
          createdAt: new Date(0),
        };
        yield* old.create("deployments", deployment);
        const app = {
          id: AppId.make("app_webhook"),
          code: deployment.code,
          owner: account.owner,
          name: "Webhook App",
          slug: AppSlug.make("old-custom-name"),
          activeDeployment: deployment.id,
          accounts: { service: account.id },
          createdAt: new Date(0),
        };
        yield* old.create("apps", app);
        const hook = {
          id: WebhookId.make("whk_existing"),
          app: app.id,
          owner: app.owner,
          key: "events",
          deployment: deployment.id,
          name: "events",
          sourceAccount: account.id,
          callbackUrl: "https://example.test/callback",
          accounts: app.accounts,
          status: "active",
          revision: "one",
          leaseUntil: new Date(0),
          failure: null,
          encrypted: new Uint8Array([7, 8, 9]),
          createdAt: new Date(0),
        };
        yield* old.create("webhooks", hook);
        const reference = {
          id: `${hook.id}/${account.id}`,
          account: account.id,
          subscription: hook.id,
        };
        yield* old.create("webhookAccounts", reference);
        const storage = yield* makeExecutorStorage({ provider: "postgresql" });
        yield* storage.migrate;
        const current = storage.orm("1.9.0");
        assert.deepEqual(yield* current.findMany("apps", {}), [
          { ...app, slug: AppSlug.make("webhook-app") },
        ]);
        assert.deepEqual(yield* current.findMany("webhooks", {}), [hook]);
        assert.deepEqual(yield* current.findMany("webhookAccounts", {}), [reference]);
        assert.deepEqual(yield* current.findMany("accounts", {}), [account]);
        assert.deepEqual(yield* migrator.version, Option.some("1.9.0"));
      }),
    ).pipe(Effect.provide(pgliteLayer())),
  ));

test("workflow migration preserves current app identity, ciphertext, and deployment constraints", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const client = executorDatabase.client(sqlAdapter({ provider: "postgresql" }));
        const migrator = yield* client.createMigrator;
        yield* (yield* migrator.migrateTo("1.8.2")).execute;
        const old = client.orm("1.8.2");
        yield* old.create("providers", { id: provider, definition: {} });
        yield* old.create("accounts", account);
        const deployment = {
          id: DeploymentId.make("dpl_workflow_migration"),
          code: AppCodeId.make("code_workflow_migration"),
          owner: account.owner,
          files: [],
          build: BuildId.make("bld_workflow_migration"),
          requirements: { accounts: {} },
          createdAt: new Date(0),
        };
        yield* old.create("deployments", deployment);
        const app = {
          id: AppId.make("app_workflow_migration"),
          code: deployment.code,
          owner: account.owner,
          name: "Workflow migration",
          slug: AppSlug.make("workflow-migration"),
          activeDeployment: deployment.id,
          accounts: { service: account.id },
          createdAt: new Date(0),
        };
        yield* old.create("apps", app);
        const storage = yield* makeExecutorStorage({ provider: "postgresql" });
        yield* storage.migrate;
        const current = storage.orm("1.9.0");
        assert.deepEqual(yield* current.findMany("apps", {}), [app]);
        assert.deepEqual(yield* current.findMany("accounts", {}), [account]);
        assert.deepEqual(yield* current.findMany("deployments", {}), [deployment]);
        assert.deepEqual(yield* current.findMany("workflowRuns", {}), []);
        assert.deepEqual(yield* current.findMany("workflowAccounts", {}), []);
        const removed = yield* current
          .deleteMany("deployments", { where: (b) => b("id", "=", deployment.id) })
          .pipe(Effect.result);
        assert.equal(removed._tag, "Failure");
      }),
    ).pipe(Effect.provide(pgliteLayer())),
  ));
