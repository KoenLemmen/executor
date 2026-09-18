/* oxlint-disable executor/no-error-constructor, executor/no-try-catch-or-throw -- boundary: out-of-band migration CLI */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate as migrateDrizzle } from "drizzle-orm/postgres-js/migrator";
import { Result } from "effect";
import postgres from "postgres";

import {
  TOO_MANY_CONNECTIONS_RETRIES,
  TOO_MANY_CONNECTIONS_RETRY_INTERVAL,
  retryWhileTooManyConnections,
} from "../src/db/too-many-connections";
import { cloudCodeMigrations, runCodeMigrations } from "./code-migrations/index";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = resolve(__dirname, "../drizzle");

const args = process.argv.slice(2);
const hasArg = (name: string): boolean => args.includes(name);
const argValue = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const dryRun = hasArg("--dry-run");
const schemaOnly = hasArg("--schema-only");
const codeOnly = hasArg("--code-only");
const r2Bucket = argValue("--bucket") ?? process.env.CLOUD_CODE_MIGRATION_R2_BUCKET;
const limitRaw = argValue("--limit");
const limit = limitRaw ? Number(limitRaw) : undefined;

if (schemaOnly && codeOnly) {
  throw new Error("--schema-only and --code-only cannot be used together");
}
if (limitRaw && !Number.isFinite(limit)) {
  throw new Error("--limit must be a number");
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const usesLocalDatabase =
  connectionString.includes("127.0.0.1") || connectionString.includes("localhost");

const sql = postgres(connectionString, {
  max: 1,
  prepare: false,
  ...(usesLocalDatabase ? {} : { ssl: "require" as const }),
});

// The first statement is where a full server refuses the connection (SQLSTATE
// 53300). Nothing has been applied at that point and the slots free up within
// minutes — see src/db/too-many-connections.ts — so wait and try again instead
// of failing the deploy. postgres.js reconnects on the next query by itself.
const onRefused = (_failure: unknown, attempt: number) => {
  console.warn(
    `[schema-migrate] Postgres refused the connection: no free connection slots (attempt ${attempt} of ${TOO_MANY_CONNECTIONS_RETRIES + 1}); retrying in ${TOO_MANY_CONNECTIONS_RETRY_INTERVAL}`,
  );
};

try {
  if (!codeOnly) {
    if (dryRun) {
      console.log("[schema-migrate] dry run: Drizzle SQL migrations are not applied");
    } else {
      console.log(`[schema-migrate] running Drizzle migrations from ${MIGRATIONS_FOLDER}`);
      const migrated = await retryWhileTooManyConnections(
        () => migrateDrizzle(drizzle(sql), { migrationsFolder: MIGRATIONS_FOLDER }),
        { onRefused },
      );
      if (Result.isFailure(migrated)) throw migrated.failure;
      console.log("[schema-migrate] complete");
    }
  }

  if (!schemaOnly) {
    const migrations = cloudCodeMigrations({ r2Bucket, limit });
    if (migrations.length === 0) {
      console.log("[code-migrate] no code migrations configured");
    } else {
      const applied = await runCodeMigrations(sql, migrations, { dryRun });
      console.log(
        dryRun
          ? `[code-migrate] dry run planned ${applied.length} migration(s)`
          : `[code-migrate] applied ${applied.length} migration(s)`,
      );
    }
  }
} finally {
  await sql.end({ timeout: 0 });
}
