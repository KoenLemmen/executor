/** The hosted auth database is Postgres; other SQL drivers do not belong in this Worker. */
import { Postgres } from "@alchemy.run/better-auth/Postgres";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Layer } from "effect";
import { DatabaseConnection } from "./database.ts";

/** Resolve the native Hyperdrive binding once; Postgres keeps its pool in the invocation scope. */
export const cloudAuthDatabase = Layer.unwrap(
  Effect.gen(function* () {
    const connection = yield* Cloudflare.Hyperdrive.Connect(yield* DatabaseConnection);
    return Postgres(connection.connectionString, { migrate: false });
  }),
).pipe(Layer.provide(Cloudflare.Hyperdrive.ConnectBinding));
