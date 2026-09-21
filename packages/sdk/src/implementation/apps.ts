import { AppWebhooksActive } from "../contracts/apps.ts";
import { appSlug } from "../contracts/app-slug.ts";
/** Durable configured apps and immutable deployments, sharing one execution path. */
import { Clock, type Crypto, Effect, Schema } from "effect";
import { SqlError } from "effect/unstable/sql";
import {
  App,
  AppNameTaken,
  AppNotFound,
  AppSlugTaken,
  AppRequirements,
} from "../contracts/apps.ts";
import {
  AppDeploymentChanged,
  Deployment,
  DeploymentBuildFailed,
  DeploymentNotFound,
  DeploymentSummary,
  SourceFiles,
} from "../contracts/deployment.ts";
import type { Executor } from "../contracts/executor.ts";
import { RuntimeBuildFailed, type Runtime } from "../contracts/runtime.ts";
import { AppCodeId, AppId, DeploymentId, OwnerId, StorageError } from "../contracts/shared.ts";
import { StoredApp, StoredDeployment } from "../contracts/storage.ts";
import { query, transaction, type Query } from "./database.ts";
import { identifyProvider } from "./provider.ts";
import { validateSelection } from "./selection.ts";
import { prepareAppSkills } from "./skill-source.ts";

type DeployInput = NonNullable<Parameters<Executor["apps"]["deploy"]>[0]>;

/** Read a configured app, applying an optional owner constraint. */
export const storedApp = (db: Query, input: Parameters<Executor["apps"]["get"]>[0]) =>
  Effect.gen(function* () {
    const row = yield* query(() =>
      db.findFirst("apps", {
        where: (b) =>
          b.and(
            b("id", "=", input.app),
            input.owner === undefined ? true : b("owner", "=", input.owner),
          ),
      }),
    );
    if (row === null) return yield* Effect.fail(new AppNotFound({ app: input.app }));
    return yield* Schema.decodeUnknownEffect(StoredApp)(row).pipe(
      Effect.mapError(() => new StorageError()),
    );
  });

/** Lock the app before changing selections or deployment; only write its immutable code identity, then reread. */
export const lockApp = (db: Query, input: Parameters<Executor["apps"]["get"]>[0]) =>
  Effect.gen(function* () {
    const app = yield* storedApp(db, input);
    yield* query(() =>
      db.updateMany("apps", {
        where: (b) => b.and(b("id", "=", app.id), b("code", "=", app.code)),
        set: { code: app.code },
      }),
    );
    return yield* storedApp(db, input);
  });

/** Read a deployment from this app's lineage, including its retained source and requirements. */
export const storedDeployment = (
  db: Query,
  app: StoredApp,
  deployment: DeploymentId = app.activeDeployment,
  deploymentOwner?: OwnerId,
) =>
  Effect.gen(function* () {
    const row = yield* query(() =>
      db.findFirst("deployments", {
        where: (b) =>
          b.and(
            b("id", "=", deployment),
            b("code", "=", app.code),
            deploymentOwner === undefined ? true : b("owner", "=", deploymentOwner),
          ),
      }),
    );
    if (row === null)
      return yield* Effect.fail(new DeploymentNotFound({ app: app.id, deployment }));
    return yield* Schema.decodeUnknownEffect(StoredDeployment)(row).pipe(
      Effect.mapError(() => new StorageError()),
    );
  });

const StoredDeploymentRequirements = Schema.Struct({ requirements: AppRequirements });
const DeploymentMetadata = Schema.Struct({
  id: DeploymentId,
  code: AppCodeId,
  owner: OwnerId,
  createdAt: Schema.Date,
  fileCount: Schema.Int.check(Schema.isGreaterThan(0)),
});

/** Project an app without reading or decoding its retained source files. */
function project(db: Query, app: StoredApp) {
  return query(() =>
    db.findFirst("deployments", {
      select: ["requirements"],
      where: (b) => b.and(b("id", "=", app.activeDeployment), b("code", "=", app.code)),
    }),
  ).pipe(
    Effect.flatMap((row) =>
      row === null
        ? Effect.fail(new StorageError())
        : Schema.decodeUnknownEffect(StoredDeploymentRequirements)(row).pipe(
            Effect.mapError(() => new StorageError()),
          ),
    ),
    Effect.map((deployment): App => ({ ...app, requirements: deployment.requirements })),
  );
}

/** Translate atomic name/address constraints without hiding unrelated database failures. */
const appWriteFailure = (app: Pick<StoredApp, "owner" | "name" | "slug">) => (error: unknown) => {
  if (SqlError.isSqlError(error) && Schema.is(SqlError.UniqueViolation)(error.reason)) {
    if (error.reason.constraint === "executor_apps_owner_name")
      return new AppNameTaken({ owner: app.owner, name: app.name });
    if (error.reason.constraint === "executor_apps_owner_slug")
      return new AppSlugTaken({ owner: app.owner, slug: app.slug });
  }
  return new StorageError();
};
const createApp = (db: Query, app: StoredApp) =>
  db.create("apps", app).pipe(Effect.mapError(appWriteFailure(app)));

/** Bind app operations; all network/build work finishes before any database transaction. */
export const makeApps = (db: Query, runtime: Runtime, crypto: Crypto.Crypto) => ({
  deploy: (input: DeployInput) =>
    Effect.gen(function* () {
      const deployName = yield* Effect.gen(function* () {
        if (input.app === undefined) return input.name;
        const current = yield* storedApp(db, { app: input.app, owner: input.owner });
        if (current.activeDeployment !== input.expectedDeployment) {
          return yield* new AppDeploymentChanged({
            app: input.app,
            expected: input.expectedDeployment,
            current: current.activeDeployment,
          });
        }
        return current.name;
      });
      const files = yield* Schema.decodeUnknownEffect(SourceFiles)(input.files).pipe(
        Effect.mapError(
          () =>
            new DeploymentBuildFailed({
              owner: input.owner,
              name: deployName,
              reason: "Invalid source files",
            }),
        ),
      );
      yield* prepareAppSkills(files);
      const built = yield* runtime.build({ files }).pipe(
        Effect.mapError(
          (error) =>
            new DeploymentBuildFailed({
              owner: input.owner,
              name: deployName,
              reason:
                Schema.is(RuntimeBuildFailed)(error) && error.dependency !== undefined
                  ? `Add ${error.dependency} to package.json dependencies.`
                  : "App build failed",
            }),
        ),
      );
      const entries = yield* Effect.forEach(
        Object.entries(built.requirements.accounts),
        ([slot, value]) =>
          identifyProvider(value.definition, crypto).pipe(
            Effect.map((provider) => ({ slot, provider, cardinality: value.cardinality })),
          ),
      );
      const requirements: AppRequirements = {
        ...(built.requirements.database === undefined
          ? {}
          : { database: built.requirements.database }),
        accounts: Object.fromEntries(
          entries.map(({ slot, provider, cardinality }) => [
            slot,
            { provider: provider.id, definition: provider.definition, cardinality },
          ]),
        ),
      };
      return yield* transaction(db, (tx) =>
        Effect.gen(function* () {
          const row = yield* query(() =>
            tx.findFirst("apps", {
              where: (b) =>
                input.app !== undefined
                  ? b.and(b("id", "=", input.app), b("owner", "=", input.owner))
                  : b.and(b("owner", "=", input.owner), b("name", "=", deployName)),
            }),
          );
          const existing =
            row === null ? undefined : yield* lockApp(tx, { app: row.id, owner: input.owner });
          if (input.app !== undefined && existing === undefined)
            return yield* Effect.fail(new AppNotFound({ app: input.app }));
          if (existing !== undefined && input.app === undefined && input.createOnly === true)
            return yield* Effect.fail(new AppNameTaken({ owner: input.owner, name: deployName }));
          if (
            input.app !== undefined &&
            existing !== undefined &&
            existing.activeDeployment !== input.expectedDeployment
          ) {
            return yield* Effect.fail(
              new AppDeploymentChanged({
                app: existing.id,
                expected: input.expectedDeployment,
                current: existing.activeDeployment,
              }),
            );
          }
          const appId =
            existing?.id ??
            AppId.make(
              `app_${yield* crypto.randomUUIDv4.pipe(Effect.mapError(() => new StorageError()))}`,
            );
          const code =
            existing?.code ??
            AppCodeId.make(
              `code_${yield* crypto.randomUUIDv4.pipe(Effect.mapError(() => new StorageError()))}`,
            );
          const createdAt = new Date(yield* Clock.currentTimeMillis);
          const accounts = existing === undefined ? {} : existing.accounts;
          yield* validateSelection(tx, appId, requirements, accounts);
          for (const { provider } of entries) {
            yield* query(() =>
              tx.upsert("providers", {
                where: (b) => b("id", "=", provider.id),
                create: provider,
                update: { definition: provider.definition },
              }),
            );
          }
          const deployment = {
            id: DeploymentId.make(
              `dpl_${yield* crypto.randomUUIDv4.pipe(Effect.mapError(() => new StorageError()))}`,
            ),
            code,
            owner: input.owner,
            files,
            build: built.build,
            createdAt,
          };
          const encodedRequirements = yield* Schema.encodeEffect(
            Schema.toCodecJson(AppRequirements),
          )(requirements).pipe(Effect.mapError(() => new StorageError()));
          yield* query(() =>
            tx.create("deployments", { ...deployment, requirements: encodedRequirements }),
          );
          const app = {
            id: appId,
            code,
            owner: input.owner,
            name: existing?.name ?? deployName,
            slug: appSlug(existing?.name ?? deployName),
            accounts,
            activeDeployment: deployment.id,
            createdAt: existing === undefined ? createdAt : existing.createdAt,
          };
          if (existing === undefined) yield* createApp(tx, { ...app, name: deployName });
          else
            yield* query(() =>
              tx.updateMany("apps", {
                where: (b) => b("id", "=", app.id),
                set: { activeDeployment: deployment.id },
              }),
            );
          return { app: { ...app, requirements }, deployment };
        }),
      );
    }).pipe(Effect.withSpan("sdk.apps.deploy")),
  add: (input: Parameters<Executor["apps"]["add"]>[0]) =>
    transaction(db, (tx) =>
      Effect.gen(function* () {
        const source = yield* storedApp(tx, { app: input.from });
        const taken = yield* query(() =>
          tx.findFirst("apps", {
            where: (b) => b.and(b("owner", "=", input.owner), b("name", "=", input.name)),
          }),
        );
        if (taken !== null)
          return yield* Effect.fail(new AppNameTaken({ owner: input.owner, name: input.name }));
        const app = {
          ...source,
          id: AppId.make(
            `app_${yield* crypto.randomUUIDv4.pipe(Effect.mapError(() => new StorageError()))}`,
          ),
          owner: input.owner,
          name: input.name,
          slug: appSlug(input.name),
          accounts: {},
          createdAt: new Date(yield* Clock.currentTimeMillis),
        };
        yield* createApp(tx, app);
        return yield* project(tx, app);
      }),
    ).pipe(Effect.withSpan("sdk.apps.add")),
  get: (input: Parameters<Executor["apps"]["get"]>[0]) =>
    transaction(db, (tx) =>
      storedApp(tx, input).pipe(Effect.flatMap((app) => project(tx, app))),
    ).pipe(Effect.withSpan("sdk.apps.get")),
  list: (input: NonNullable<Parameters<Executor["apps"]["list"]>[0]> = {}) =>
    transaction(db, (tx) =>
      Effect.gen(function* () {
        const rows = yield* query(() =>
          tx.findMany("apps", {
            where: (b) =>
              b.and(
                input.owner === undefined ? true : b("owner", "=", input.owner),
                input.ids === undefined ? true : b("id", "in", input.ids),
                input.name === undefined ? true : b("name", "=", input.name),
                input.slug === undefined ? true : b("slug", "=", input.slug),
                input.account === undefined ? true : b("accounts", "json contains", input.account),
              ),
            orderBy: ["id", "asc"],
          }),
        );
        const stored = yield* Schema.decodeUnknownEffect(Schema.Array(StoredApp))(rows).pipe(
          Effect.mapError(() => new StorageError()),
        );
        return yield* Effect.forEach(stored, (app) => project(tx, app));
      }),
    ).pipe(Effect.withSpan("sdk.apps.list")),
  rename: (input: Parameters<Executor["apps"]["rename"]>[0]) =>
    transaction(db, (tx) =>
      Effect.gen(function* () {
        const app = yield* lockApp(tx, input);
        const taken = yield* query(() =>
          tx.findFirst("apps", {
            where: (b) => b.and(b("owner", "=", app.owner), b("name", "=", input.name)),
          }),
        );
        if (taken !== null && taken.id !== app.id)
          return yield* new AppNameTaken({ owner: app.owner, name: input.name });
        const renamed = { ...app, name: input.name, slug: appSlug(input.name) };
        // The derived key and name move atomically; the unique constraint serializes colliding renames.
        yield* tx
          .updateMany("apps", {
            where: (b) => b("id", "=", app.id),
            set: { name: renamed.name, slug: renamed.slug },
          })
          .pipe(Effect.mapError(appWriteFailure(renamed)));
        return yield* project(tx, renamed);
      }),
    ).pipe(Effect.withSpan("sdk.apps.rename")),
  update: (input: Parameters<Executor["apps"]["update"]>[0]) =>
    transaction(db, (tx) =>
      Effect.gen(function* () {
        const app = yield* lockApp(tx, input);
        const current = yield* project(tx, app);
        yield* validateSelection(tx, app.id, current.requirements, input.accounts);
        yield* query(() =>
          tx.updateMany("apps", {
            where: (b) => b("id", "=", app.id),
            set: { accounts: input.accounts },
          }),
        );
        return { ...current, accounts: input.accounts };
      }),
    ).pipe(Effect.withSpan("sdk.apps.update")),
  remove: (input: Parameters<Executor["apps"]["remove"]>[0]) =>
    transaction(db, (tx) =>
      Effect.gen(function* () {
        const app = yield* query(() =>
          tx.findFirst("apps", {
            where: (b) =>
              input.owner === undefined
                ? b("id", "=", input.app)
                : b.and(b("id", "=", input.app), b("owner", "=", input.owner)),
          }),
        );
        if (app !== null) {
          yield* query(() =>
            tx.updateMany("apps", {
              where: (b) => b("id", "=", app.id),
              set: { createdAt: app.createdAt },
            }),
          );
          const live = yield* query(() =>
            tx.findFirst("webhooks", {
              where: (b) => b.and(b("app", "=", app.id), b("status", "!=", "stopped")),
            }),
          );
          if (live !== null) return yield* new AppWebhooksActive({ app: app.id });
          yield* query(() => tx.deleteMany("webhooks", { where: (b) => b("app", "=", app.id) }));
          yield* query(() => tx.deleteMany("appRecords", { where: (b) => b("app", "=", app.id) }));
          yield* query(() => tx.deleteMany("apps", { where: (b) => b("id", "=", app.id) }));
        }
        return { app: input.app };
      }),
    ).pipe(Effect.withSpan("sdk.apps.remove")),
  activate: (input: Parameters<Executor["apps"]["activate"]>[0]) =>
    transaction(db, (tx) =>
      Effect.gen(function* () {
        const app = yield* lockApp(tx, input);
        if (
          input.expectedDeployment !== undefined &&
          app.activeDeployment !== input.expectedDeployment
        ) {
          return yield* Effect.fail(
            new AppDeploymentChanged({
              app: app.id,
              expected: input.expectedDeployment,
              current: app.activeDeployment,
            }),
          );
        }
        const deployment = yield* storedDeployment(tx, app, input.deployment);
        yield* validateSelection(tx, app.id, deployment.requirements, app.accounts);
        yield* query(() =>
          tx.updateMany("apps", {
            where: (b) => b("id", "=", app.id),
            set: { activeDeployment: deployment.id },
          }),
        );
        return { ...app, activeDeployment: deployment.id, requirements: deployment.requirements };
      }),
    ).pipe(Effect.withSpan("sdk.apps.activate")),
  deployments: (input: Parameters<Executor["apps"]["deployments"]>[0]) =>
    transaction(db, (tx) =>
      Effect.gen(function* () {
        const app = yield* storedApp(tx, input);
        const rows = yield* query(() =>
          tx.findMany("deployments", {
            select: ["id", "code", "owner", "createdAt"],
            computed: [{ kind: "jsonArrayLength", column: "files", alias: "fileCount" }],
            where: (b) =>
              b.and(
                b("code", "=", app.code),
                input.deploymentOwner === undefined ? true : b("owner", "=", input.deploymentOwner),
              ),
            orderBy: ["createdAt", "desc"],
          }),
        );
        const decoded = yield* Schema.decodeUnknownEffect(Schema.Array(DeploymentMetadata))(
          rows,
        ).pipe(Effect.mapError(() => new StorageError()));
        return decoded
          .toSorted(
            (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id),
          )
          .map((deployment): DeploymentSummary => ({
            id: deployment.id,
            code: deployment.code,
            owner: deployment.owner,
            createdAt: deployment.createdAt,
            fileCount: deployment.fileCount,
          }));
      }),
    ).pipe(Effect.withSpan("sdk.apps.deployments")),
  source: (input: Parameters<Executor["apps"]["source"]>[0]) =>
    transaction(db, (tx) =>
      Effect.gen(function* () {
        const app = yield* storedApp(tx, input);
        return yield* storedDeployment(tx, app, input.deployment, input.deploymentOwner).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Deployment)),
          Effect.mapError((error) =>
            Schema.is(DeploymentNotFound)(error) ? error : new StorageError(),
          ),
        );
      }),
    ).pipe(Effect.withSpan("sdk.apps.source")),
});
