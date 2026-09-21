import { AppSlugTaken } from "../contracts/apps.ts";
import { AppSlug, appSlug } from "../contracts/app-slug.ts";
/** FumaDB schema and client factory. Importing this module performs no I/O. */
import { fumadb } from "fumadb-effect";
import { Effect, Schema, Option } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { sqlAdapter } from "fumadb-effect/sql";
import type { Provider as SqlProvider } from "fumadb-effect";
import { makeReactiveStore } from "@executor-js/reactivity";
import { bindOrm } from "./reactive-orm.ts";
import {
  AccountId,
  WebhookId,
  AppId,
  AppCodeId,
  DeploymentId,
  BuildId,
  OwnerId,
  ProviderId,
  JsonObject,
} from "../contracts/shared.ts";
import { StorageError } from "../contracts/shared.ts";
import { AccountConnectionId, ApprovalRequestId } from "../contracts/shared.ts";
import { column, idColumn, schema, table } from "fumadb-effect/schema";

/**
 * Initial storage layout. JSON columns are unknown at the database boundary;
 * the SDK must decode them using its Effect contracts before using them.
 * IDs, owners, timestamps and account maps are explicit, with no generated
 * defaults. Owners are opaque data, not foreign keys or access decisions.
 */
const initialSchema = schema({
  version: "1.0.0",
  tables: {
    providers: table("executor_providers", {
      id: idColumn("id", ProviderId, { type: "varchar(255)" }),
      definition: column("definition", Schema.Json),
    }),
    accounts: table("executor_accounts", {
      id: idColumn("id", AccountId, { type: "varchar(255)" }),
      owner: column("owner", OwnerId, { type: "varchar(255)" }),
      provider: column("provider", ProviderId, { type: "varchar(255)" }),
      method: column("method", Schema.String),
      label: column("label", Schema.String),
      encryptedCredentials: column("encrypted_credentials", Schema.Uint8Array),
      createdAt: column("created_at", Schema.Date),
    }),
    deployments: table("executor_deployments", {
      id: idColumn("id", DeploymentId, { type: "varchar(255)" }),
      code: column("code", AppCodeId, { type: "varchar(255)" }),
      owner: column("owner", OwnerId, { type: "varchar(255)" }),
      files: column("files", Schema.Json),
      build: column("build", BuildId, { type: "varchar(255)" }),
      requirements: column("requirements", Schema.Json),
      createdAt: column("created_at", Schema.Date),
    }).unique("executor_deployments_id_code", ["id", "code"]),
    apps: table("executor_apps", {
      id: idColumn("id", AppId, { type: "varchar(255)" }),
      code: column("code", AppCodeId, { type: "varchar(255)" }),
      owner: column("owner", OwnerId, { type: "varchar(255)" }),
      name: column("name", Schema.String, { type: "varchar(255)" }),
      activeDeployment: column("active_deployment", DeploymentId, { type: "varchar(255)" }),
      // Preserve missing slots, one account, and explicit [] as distinct values.
      accounts: column("accounts", Schema.Json),
      createdAt: column("created_at", Schema.Date),
    }).unique("executor_apps_owner_name", ["owner", "name"]),
  },
  relations: {
    accounts: ({ one }) => ({
      providerDefinition: one("providers", ["provider", "id"]).foreignKey(),
    }),
    apps: ({ one }) => ({
      // A configured app can activate only deployments from its own lineage.
      deployment: one("deployments", ["activeDeployment", "id"], ["code", "code"]).foreignKey(),
    }),
  },
});

/** Additive OAuth storage: existing account identities, ciphertexts, and selections are unchanged. */
const oauthSchema = schema({
  version: "1.1.0",
  tables: {
    ...initialSchema.tables,
    oauthClients: table("executor_oauth_clients", {
      id: idColumn("id", Schema.String, { type: "varchar(255)" }),
      encrypted: column("encrypted", Schema.Uint8Array),
    }),
    oauthAttempts: table("executor_oauth_attempts", {
      id: idColumn("id", Schema.String, { type: "varchar(255)" }),
      encrypted: column("encrypted", Schema.Uint8Array),
      expiresAt: column("expires_at", Schema.Date),
      status: column("status", Schema.String),
    }),
    oauthGrants: table("executor_oauth_grants", {
      id: idColumn("id", Schema.String, { type: "varchar(255)" }),
      encrypted: column("encrypted", Schema.Uint8Array),
      status: column("status", Schema.String),
      updatedAt: column("updated_at", Schema.Date),
    }),
  },
});

/** App records belong to a configured app, independently of its active deployment. */
const appDataSchema = schema({
  version: "1.2.0",
  tables: {
    ...oauthSchema.tables,
    appRecords: table("executor_app_records", {
      id: idColumn("id", Schema.String, { type: "varchar(255)" }),
      app: column("app", AppId, { type: "varchar(255)" }),
      table: column("table_name", Schema.String, { type: "varchar(255)" }),
      key: column("record_key", Schema.String, { type: "varchar(255)" }),
      value: column("value", JsonObject),
    }).unique("executor_app_records_app_table_key", ["app", "table", "key"]),
  },
});

/** Add connection requests without changing saved accounts, grants, or app selections. */
const connectionSchema = schema({
  version: "1.3.0",
  tables: {
    ...appDataSchema.tables,
    accountConnections: table("executor_account_connections", {
      id: idColumn("id", AccountConnectionId, { type: "varchar(255)" }),
      owner: column("owner", OwnerId, { type: "varchar(255)" }),
      provider: column("provider", ProviderId, { type: "varchar(255)" }),
      reconnectAccount: column("reconnect_account", Schema.NullOr(AccountId), {
        type: "varchar(255)",
      }),
      state: column("state", Schema.Json),
      revision: column("revision", Schema.String, { type: "varchar(255)" }),
      oauthAttempt: column("oauth_attempt", Schema.NullOr(Schema.String), { type: "varchar(255)" }),
      createdAt: column("created_at", Schema.Date),
      expiresAt: column("expires_at", Schema.Date),
    }),
  },
});

/** Existing requests remain standalone. App targets retain their original requirement and selection. */
const targetSchema = schema({
  version: "1.4.0",
  tables: {
    ...connectionSchema.tables,
    accountConnections: table("executor_account_connections", {
      ...connectionSchema.tables.accountConnections.columns,
      target: column("target", Schema.NullOr(Schema.Json)).default(null),
    }),
  },
});

/** Additive pending-invocation storage. Existing resource rows and credentials are unchanged. */
const approvalSchema = schema({
  version: "1.5.0",
  tables: {
    ...targetSchema.tables,
    toolApprovals: table("executor_tool_approvals", {
      id: idColumn("id", ApprovalRequestId, { type: "varchar(255)" }),
      owner: column("owner", OwnerId, { type: "varchar(255)" }),
      status: column("status", Schema.String, { type: "varchar(255)" }),
      revision: column("revision", Schema.String, { type: "varchar(255)" }),
      // Pending ciphertext only; consumption atomically clears it. Tool outputs are never stored.
      encrypted: column("encrypted", Schema.Uint8Array),
      expiresAt: column("expires_at", Schema.Date),
    }),
  },
});

/** Transitional column for a one-time backfill; never exposed by the current ORM. */
const slugBackfillSchema = schema({
  version: "1.6.0",
  tables: {
    ...approvalSchema.tables,
    apps: table("executor_apps", {
      ...approvalSchema.tables.apps.columns,
      slug: column("slug", Schema.NullOr(AppSlug), { type: "varchar(63)" }),
    }).unique("executor_apps_owner_name", ["owner", "name"]),
  },
  relations: {
    apps: ({ one }) => ({
      deployment: one("deployments", ["activeDeployment", "id"], ["code", "code"]).foreignKey(),
    }),
  },
});
/** Current storage requires one slug per configured app, unique inside its owner. */
const savedSlugSchema = schema({
  version: "1.7.0",
  tables: {
    ...slugBackfillSchema.tables,
    apps: table("executor_apps", {
      ...slugBackfillSchema.tables.apps.columns,
      slug: column("slug", AppSlug, { type: "varchar(63)" }),
    })
      .unique("executor_apps_owner_name", ["owner", "name"])
      .unique("executor_apps_owner_slug", ["owner", "slug"]),
  },
  relations: {
    apps: ({ one }) => ({
      deployment: one("deployments", ["activeDeployment", "id"], ["code", "code"]).foreignKey(),
    }),
  },
});

/** The indexed address is derived from name; it is no longer an independent editable value. */
const derivedSlugSchema = schema({ version: "1.7.1", tables: savedSlugSchema.tables });

/** Additive subscription storage. State/configuration and callback secrets share the encrypted envelope. */
const webhookSchema = schema({
  version: "1.8.0",
  tables: {
    ...derivedSlugSchema.tables,
    webhookAccounts: table("executor_webhook_accounts", {
      id: idColumn("id", Schema.String, { type: "varchar(255)" }),
      account: column("account", AccountId, { type: "varchar(255)" }),
      subscription: column("subscription", WebhookId, { type: "varchar(255)" }),
    })
      .unique("executor_webhook_accounts_account_subscription", ["account", "subscription"])
      .unique("executor_webhook_accounts_subscription_account", ["subscription", "account"]),
    webhooks: table("executor_webhooks", {
      id: idColumn("id", WebhookId, { type: "varchar(255)" }),
      app: column("app", AppId, { type: "varchar(255)" }),
      owner: column("owner", OwnerId, { type: "varchar(255)" }),
      key: column("subscription_key", Schema.String, { type: "varchar(128)" }),
      deployment: column("deployment", DeploymentId, { type: "varchar(255)" }),
      name: column("name", Schema.String),
      sourceAccount: column("source_account", AccountId, { type: "varchar(255)" }),
      callbackUrl: column("callback_url", Schema.String),
      accounts: column("accounts", Schema.Json),
      status: column("status", Schema.String, { type: "varchar(32)" }),
      revision: column("revision", Schema.String, { type: "varchar(255)" }),
      leaseUntil: column("lease_until", Schema.Date),
      failure: column("failure", Schema.NullOr(Schema.String)),
      encrypted: column("encrypted", Schema.Uint8Array),
      createdAt: column("created_at", Schema.Date),
    }).unique("executor_webhooks_app_key", ["app", "key"]),
  },
});

/** Preserve webhook records while staging a one-time re-derivation of old app addresses. */
const webhookSlugBackfillSchema = schema({
  version: "1.8.1",
  tables: {
    ...webhookSchema.tables,
    apps: table("executor_apps", {
      ...webhookSchema.tables.apps.columns,
      slug: column("slug", Schema.NullOr(AppSlug), { type: "varchar(63)" }),
    }).unique("executor_apps_owner_name", ["owner", "name"]),
  },
  relations: {
    apps: ({ one }) => ({
      deployment: one("deployments", ["activeDeployment", "id"], ["code", "code"]).foreignKey(),
    }),
  },
});
/** Current schema enforces derived address uniqueness while retaining all webhook tables. */
export const storageSchema = schema({
  version: "1.8.2",
  tables: {
    ...webhookSlugBackfillSchema.tables,
    apps: table("executor_apps", {
      ...webhookSlugBackfillSchema.tables.apps.columns,
      slug: column("slug", AppSlug, { type: "varchar(63)" }),
    })
      .unique("executor_apps_owner_name", ["owner", "name"])
      .unique("executor_apps_owner_slug", ["owner", "slug"]),
  },
  relations: {
    apps: ({ one }) => ({
      deployment: one("deployments", ["activeDeployment", "id"], ["code", "code"]).foreignKey(),
    }),
  },
});

/** Versioned schema metadata. Use makeExecutorStorage.migrate for upgrades, including data backfills. */
export const executorDatabase = fumadb({
  namespace: "executor",
  schemas: [
    initialSchema,
    oauthSchema,
    appDataSchema,
    connectionSchema,
    targetSchema,
    approvalSchema,
    slugBackfillSchema,
    savedSlugSchema,
    derivedSlugSchema,
    webhookSchema,
    webhookSlugBackfillSchema,
    storageSchema,
  ],
});

/** Capture the host SQL client and one shared reactive coordinator for all SDK callers. */
export const makeExecutorStorage = (options: { readonly provider: SqlProvider }) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const reactivity = yield* makeReactiveStore({ namespace: "executor" });
    const client = executorDatabase.client(sqlAdapter({ provider: options.provider }));
    const db = bindOrm(client.orm("1.8.2"), sql, reactivity);
    const migrate = Effect.gen(function* () {
      const migrator = yield* client.createMigrator;
      const version = yield* migrator.version;
      if (Option.isSome(version) && version.value === "1.8.2") return;
      yield* (yield* migrator.migrateTo("1.8.1")).execute;
      const rows = yield* client.orm("1.8.1").findMany("apps", { orderBy: ["id", "asc"] });
      const owners = new Map<string, Set<string>>();
      const derived = rows.map((row) => ({ ...row, slug: appSlug(row.name) }));
      for (const row of derived) {
        const taken = owners.get(row.owner) ?? new Set<string>();
        if (taken.has(row.slug))
          return yield* new AppSlugTaken({ owner: row.owner, slug: row.slug });
        taken.add(row.slug);
        owners.set(row.owner, taken);
      }
      for (const row of derived) {
        yield* client
          .orm("1.8.1")
          .updateMany("apps", { where: (b) => b("id", "=", row.id), set: { slug: row.slug } });
      }
      yield* (yield* migrator.migrateToLatest()).execute;
    }).pipe(
      sql.withTransaction,
      Effect.provideService(SqlClient.SqlClient, sql),
      Effect.mapError((error) => (Schema.is(AppSlugTaken)(error) ? error : new StorageError())),
    );
    return { orm: (_version: "1.8.2") => db, reactivity, migrate };
  });

/** Caller-owned, Effect-native persistence with commit-driven subscriptions. */
export type ExecutorDatabase = Effect.Success<ReturnType<typeof makeExecutorStorage>>;
