/** A Postgres logical database on a shared cluster, so test stages isolate data without owning a cluster. */
import { Resource } from "alchemy";
import { isResolved } from "alchemy/Diff";
import * as Provider from "alchemy/Provider";
import { Effect, Redacted, Schema } from "effect";
import { Pool } from "pg";

export class LogicalDatabaseFailed extends Schema.TaggedError<LogicalDatabaseFailed>()(
  "LogicalDatabaseFailed",
  {
    database: Schema.String,
    statement: Schema.String,
    reason: Schema.String,
  },
) {}

export interface LogicalDatabaseProps {
  /** Admin role on the shared cluster. Only this resource uses it, to create, drop and grant. */
  readonly adminUrl: Redacted.Redacted<string>;
  readonly name: string;
  /** The PlanetScale role that owns everything inside this database. */
  readonly owner: string;
}

export interface LogicalDatabaseAttributes {
  readonly name: string;
  readonly owner: string;
}

export type LogicalDatabase = Resource<
  "Executor.LogicalDatabase",
  LogicalDatabaseProps,
  LogicalDatabaseAttributes
>;

/**
 * One Postgres database on an existing cluster, granted to a single role.
 * Stages share the cluster, so the grants are what keep one stage out of another's data.
 */
export const LogicalDatabase = Resource<LogicalDatabase>("Executor.LogicalDatabase");

/** Postgres cannot bind an identifier as a parameter, so quote it instead. */
const quoted = (identifier: string) => `"${identifier.replaceAll('"', '""')}"`;

/** The admin credentials, pointed at one logical database rather than the cluster default. */
const adminUrlFor = (adminUrl: Redacted.Redacted<string>, database: string) => {
  const url = new URL(Redacted.value(adminUrl));
  url.pathname = `/${encodeURIComponent(database)}`;
  return Redacted.make(url.toString());
};

const connect = (url: Redacted.Redacted<string>) =>
  Effect.acquireRelease(
    Effect.sync(() => new Pool({ connectionString: Redacted.value(url), max: 1 })),
    (pool) => Effect.promise(() => pool.end()),
  );

const statements =
  (pool: Pool, database: string) =>
  (statement: string, values: ReadonlyArray<string> = []) =>
    Effect.tryPromise({
      // The statement text is safe to report; the connection URL and its password never appear in it.
      try: () => pool.query(statement, [...values]),
      catch: (cause) =>
        new LogicalDatabaseFailed({
          database,
          statement,
          reason: cause instanceof Error ? cause.message : String(cause),
        }),
    });

export const LogicalDatabaseProvider = () =>
  Provider.succeed(LogicalDatabase, {
    stables: ["name"],

    /** A different name is a different database; creating the new one must not orphan the old one. */
    diff: ({ news, output }) =>
      Effect.succeed(
        isResolved(news) && output !== undefined && news.name !== output.name
          ? { action: "replace" as const }
          : undefined,
      ),

    // There is no cheap way to observe grants, and reconcile reapplies them anyway.
    read: ({ output }) => Effect.succeed(output),

    reconcile: ({ news }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const cluster = yield* connect(news.adminUrl);
          const onCluster = statements(cluster, news.name);
          // Postgres has no CREATE DATABASE IF NOT EXISTS, and a retried deploy must not fail here.
          const existing = yield* onCluster("select 1 from pg_database where datname = $1", [
            news.name,
          ]);
          if (existing.rowCount === 0) yield* onCluster(`create database ${quoted(news.name)}`);
          // Every role on the shared cluster can connect by default; only this stage's role may.
          yield* onCluster(`revoke connect on database ${quoted(news.name)} from public`);
          yield* onCluster(
            `grant connect, create, temporary on database ${quoted(news.name)} to ${quoted(news.owner)}`,
          );

          // Schema privileges live inside the database, so they need their own connection.
          const inside = yield* connect(adminUrlFor(news.adminUrl, news.name));
          const onDatabase = statements(inside, news.name);
          yield* onDatabase(`grant all on schema public to ${quoted(news.owner)}`);
          // Migrations run as the stage role, so objects the admin later adds stay reachable too.
          yield* onDatabase(
            `alter default privileges in schema public grant all on tables to ${quoted(news.owner)}`,
          );
          yield* onDatabase(
            `alter default privileges in schema public grant all on sequences to ${quoted(news.owner)}`,
          );
          return { name: news.name, owner: news.owner };
        }),
      ),

    delete: ({ olds, output }) =>
      Effect.scoped(
        Effect.gen(function* () {
          const cluster = yield* connect(olds.adminUrl);
          // FORCE ends the Hyperdrive sessions still holding the database; IF EXISTS tolerates a manual drop.
          yield* statements(
            cluster,
            output.name,
          )(`drop database if exists ${quoted(output.name)} with (force)`);
        }),
      ),
  });
