/** Schema ownership is separate even though auth and product share one Postgres database. */
import type { BetterAuthOptions } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { makeExecutorStorage } from "@executor-js/sdk/core";
import { Effect, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";

/** Migration failures stop startup; callers must not log the driver's secret-bearing cause. */
export class HostedMigrationFailed extends Schema.TaggedError<HostedMigrationFailed>()(
  "HostedMigrationFailed",
  {
    stage: Schema.Literals(["auth", "product"]),
  },
) {}

/**
 * Explicit, serialized migration job. Better Auth owns its tables; FumaDB owns executor_*.
 * Auth additions commit independently. If product migration fails, rerun the job after repair.
 * This creates/upgrades Postgres schemas, never transfers data from SQLite or D1.
 */
export const migrateHostedDatabase = (options: BetterAuthOptions) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`select pg_advisory_xact_lock(641028113)`;
        yield* migrateHostedSchemas(options);
      }),
    );
  });

/** Run both migrators; the caller holds exclusive startup/job access. */
export const migrateHostedSchemas = (options: BetterAuthOptions) =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: async () => {
        const migrations = await getMigrations(options);
        await migrations.runMigrations();
      },
      catch: () => new HostedMigrationFailed({ stage: "auth" }),
    });
    const storage = yield* makeExecutorStorage({ provider: "postgresql" });
    yield* storage.migrate.pipe(
      Effect.mapError(() => new HostedMigrationFailed({ stage: "product" })),
    );
  });
