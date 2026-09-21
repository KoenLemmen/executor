/** Groups share the hosted database while each Cloud invocation owns its SQL client. */
import { GroupDatabase, GroupsUnavailable } from "@executor-js/hosted-server/groups";
import { PgClient } from "@effect/sql-pg";
import * as Cloudflare from "alchemy/Cloudflare";
import { RuntimeContext } from "alchemy";
import { makeExecutionMemo } from "alchemy/Runtime/ExecutionMemo";
import { Context, Effect, Layer } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { DatabaseConnection } from "./database.ts";

/** Resolve bindings during composition, but acquire connections only inside a request. */
export const cloudGroupDatabase = Effect.gen(function* () {
  const connection = yield* Cloudflare.Hyperdrive.Connect(yield* DatabaseConnection);
  const database = yield* makeExecutionMemo(
    Effect.gen(function* () {
      const url = yield* connection.connectionString;
      const services = yield* Layer.build(
        PgClient.layer({ url, maxConnections: 1, prepare: false }),
      );
      return Context.get(services, SqlClient.SqlClient);
    }),
  );
  return Layer.succeed(
    GroupDatabase,
    database.pipe(
      Effect.provide(RuntimeContext.phantom),
      Effect.mapError(() => new GroupsUnavailable()),
    ),
  );
}).pipe(Effect.provide(Cloudflare.Hyperdrive.ConnectBinding));
