/** Administrative adapter for preview inventory. Never loaded into a Worker. */
import { Client } from "pg";
import { Config, Effect, Redacted, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import {
  StageRetention,
  TestStageFailed,
  type StageInventory,
} from "../contracts/test-stage-capacity.ts";
import { TestStageSlug } from "../infrastructure/stage.ts";

const retentionPrefix = "executor-test-stage:";
const positiveInteger = Schema.Int.check(Schema.isGreaterThan(0));
const nonnegativeInteger = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Hyperdrive = Schema.Struct({
  name: Schema.String,
  origin: Schema.Struct({ host: Schema.String, user: Schema.String, database: Schema.String }),
  origin_connection_limit: Schema.optional(positiveInteger),
});
const HyperdrivePage = Schema.Struct({
  success: Schema.Literal(true),
  result: Schema.Array(Hyperdrive),
  result_info: Schema.optional(Schema.Struct({ total_pages: positiveInteger })),
});
const DatabaseRow = Schema.Struct({
  database: Schema.String,
  comment: Schema.NullOr(Schema.String),
  connections: nonnegativeInteger,
});
const LimitsRow = Schema.Struct({
  max: positiveInteger,
  reserved: nonnegativeInteger,
  used: nonnegativeInteger,
});

const failed = (message: string) => new TestStageFailed({ message });
const quoted = (name: string) => `"${name.replaceAll('"', '""')}"`;
const databaseName = (slug: string) => `executor_${slug.replaceAll("-", "_")}`;

/** A connected admin session owns queries, inventory and stage retention metadata. */
const stageAdmin = (
  client: Client,
  origin: URL,
  accountId: string,
  token: Redacted.Redacted<string>,
) => {
  const query = <S extends Schema.Constraint>(
    schema: S,
    statement: string,
    values: readonly unknown[] = [],
  ) =>
    Effect.tryPromise({
      try: () => client.query(statement, [...values]),
      catch: () =>
        failed("The test database query failed. Check database availability and admin access."),
    }).pipe(
      Effect.flatMap((result) => Schema.decodeUnknownEffect(Schema.Array(schema))(result.rows)),
      Effect.mapError(() =>
        failed("The test database query failed or returned an unexpected result."),
      ),
    );

  const databases = query(
    DatabaseRow,
    `
    select d.datname as database, shobj_description(d.oid, 'pg_database') as comment,
      (select count(*)::int from pg_stat_activity a where a.datid = d.oid) as connections
    from pg_database d where not d.datistemplate and left(d.datname, 9) = 'executor_'
    order by d.datname`,
  );

  const retention = (comment: string | null) => {
    if (comment === null || !comment.startsWith(retentionPrefix)) return Effect.succeed(null);
    return Schema.decodeUnknownEffect(Schema.fromJsonString(StageRetention))(
      comment.slice(retentionPrefix.length),
    ).pipe(
      Effect.mapError(() =>
        failed(
          "A preview has invalid retention metadata. Inspect its database comment before updating it.",
        ),
      ),
    );
  };

  const listPools = Effect.gen(function* () {
    const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
    const pools: Array<typeof Hyperdrive.Type> = [];
    let page = 1;
    let totalPages = 1;
    do {
      const response = yield* http.execute(
        HttpClientRequest.get(
          `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/hyperdrive/configs?page=${page}&per_page=100`,
        ).pipe(HttpClientRequest.bearerToken(token)),
      );
      const body = yield* HttpClientResponse.schemaBodyJson(HyperdrivePage)(response);
      pools.push(...body.result);
      totalPages = body.result_info === undefined ? 1 : body.result_info.total_pages;
      page += 1;
    } while (page <= totalPages);
    // PlanetScale usernames include the branch ID. A hostname alone is not a branch identity.
    const login = decodeURIComponent(origin.username);
    const suffix = login.slice(login.lastIndexOf("."));
    return pools.filter(
      (pool) => pool.origin.host === origin.hostname && pool.origin.user.endsWith(suffix),
    );
  }).pipe(
    Effect.timeout("30 seconds"),
    Effect.mapError(() =>
      failed(
        "Could not read the full Hyperdrive inventory. Check Cloudflare credentials and permissions.",
      ),
    ),
  );

  const inventory = Effect.gen(function* () {
    const [rows, limits, pools] = yield* Effect.all(
      [
        databases,
        query(
          LimitsRow,
          `select current_setting('max_connections')::int as max,
        current_setting('superuser_reserved_connections')::int + current_setting('reserved_connections')::int as reserved,
        (select count(*)::int from pg_stat_activity where backend_type = 'client backend') as used`,
        ),
        listPools,
      ],
      { concurrency: 1 },
    );
    const limit = limits[0];
    if (limit === undefined)
      return yield* Effect.fail(failed("The database did not report its connection capacity."));
    const names = new Set([
      ...rows.map((row) => row.database),
      ...pools.map((pool) => pool.origin.database).filter((name) => name.startsWith("executor_")),
    ]);
    const stages = yield* Effect.forEach([...names].sort(), (database) =>
      Effect.gen(function* () {
        const slug = yield* Schema.decodeUnknownEffect(TestStageSlug)(
          database.slice(9).replaceAll("_", "-"),
        ).pipe(Effect.mapError(() => failed(`Unrecognized preview database name: ${database}.`)));
        const row = rows.find((row) => row.database === database);
        return {
          slug,
          database,
          connections: row === undefined ? 0 : row.connections,
          pools: pools
            .filter((pool) => pool.origin.database === database)
            .map((pool) => ({
              name: pool.name,
              limit:
                pool.origin_connection_limit === undefined ? null : pool.origin_connection_limit,
            })),
          retention: yield* retention(row === undefined ? null : row.comment),
        };
      }),
    );
    return {
      maxConnections: limit.max,
      reservedConnections: limit.reserved,
      usedConnections: limit.used,
      stages,
      otherPools: pools
        .filter((pool) => !names.has(pool.origin.database))
        .map((pool) => ({
          name: pool.name,
          limit: pool.origin_connection_limit === undefined ? null : pool.origin_connection_limit,
        })),
    } satisfies StageInventory;
  });

  const writeRetention = (slug: string, value: StageRetention) =>
    Effect.gen(function* () {
      const rows = yield* databases;
      const row = rows.find((row) => row.database === databaseName(slug));
      if (row === undefined)
        return yield* Effect.fail(
          failed(`Stage ${slug} has no database. Deploy it before setting retention.`),
        );
      if (row.comment !== null && !row.comment.startsWith(retentionPrefix))
        return yield* Effect.fail(
          failed(
            `Stage ${slug} has a database comment owned elsewhere. Its comment was preserved.`,
          ),
        );
      // quote_literal runs on the server; COMMENT cannot take a bind parameter for its literal.
      const encoded =
        retentionPrefix +
        (yield* Schema.encodeEffect(Schema.fromJsonString(StageRetention))(value));
      const literals = yield* query(
        Schema.Struct({ value: Schema.String }),
        "select quote_literal($1) as value",
        [encoded],
      );
      const literal = literals[0];
      if (literal === undefined)
        return yield* Effect.fail(failed("Could not encode stage retention."));
      yield* query(
        Schema.Unknown,
        `comment on database ${quoted(row.database)} is ${literal.value}`,
      );
    });

  return { inventory, writeRetention };
};

/**
 * Serialize cooperating deploys/destroys with a session advisory lock on postgres.
 * No transaction is held while Alchemy runs. Losing this session interrupts the child.
 */
export const withStageAdmin = <A, E, R>(
  exclusive: boolean,
  use: (admin: ReturnType<typeof stageAdmin>) => Effect.Effect<A, E, R>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const settings = yield* Config.all({
        url: Config.Redacted("TEST_STAGE_DATABASE_ADMIN_URL"),
        accountId: Config.String("CLOUDFLARE_ACCOUNT_ID"),
        token: Config.Redacted("CLOUDFLARE_API_TOKEN"),
      });
      const origin = yield* Effect.try({
        try: () => new URL(Redacted.value(settings.url)),
        catch: () => failed("Invalid test database admin URL."),
      });
      if (
        origin.port !== "5432" ||
        origin.pathname !== "/postgres" ||
        !decodeURIComponent(origin.username).includes(".")
      )
        return yield* Effect.fail(
          failed(
            "Test-stage administration requires the direct PlanetScale URL (port 5432, database postgres, branch-qualified username).",
          ),
        );
      const client = yield* Effect.acquireRelease(
        Effect.sync(
          () =>
            new Client({
              connectionString: Redacted.value(settings.url),
              connectionTimeoutMillis: 15000,
              query_timeout: 15000,
              application_name: "executor-test-stage",
            }),
        ),
        (client) => Effect.promise(() => client.end()).pipe(Effect.ignore),
      );
      const disconnected = Effect.callback<never, TestStageFailed>((resume) => {
        const lost = () =>
          resume(
            Effect.fail(
              failed(
                "The stage admin connection closed. The command was interrupted; inspect the stage before retrying.",
              ),
            ),
          );
        client.on("error", lost);
        client.on("end", lost);
        return Effect.sync(() => {
          client.off("error", lost);
          client.off("end", lost);
        });
      });
      return yield* Effect.raceFirst(
        disconnected,
        Effect.gen(function* () {
          yield* Effect.tryPromise({
            try: () => client.connect(),
            catch: () =>
              failed(
                "Cannot connect to the shared test database. Check its capacity and credentials.",
              ),
          });
          if (exclusive) {
            const result = yield* Effect.tryPromise({
              try: () => client.query("select pg_try_advisory_lock(1163412818, 1) as locked"),
              catch: () => failed("Could not acquire the test-stage deployment lock."),
            });
            const rows = yield* Schema.decodeUnknownEffect(
              Schema.Array(Schema.Struct({ locked: Schema.Boolean })),
            )(result.rows);
            if (rows[0]?.locked !== true)
              return yield* Effect.fail(
                failed(
                  "Another test-stage command is running on this cluster. Retry after it finishes.",
                ),
              );
          }
          return yield* use(stageAdmin(client, origin, settings.accountId, settings.token));
        }),
      );
    }),
  );
