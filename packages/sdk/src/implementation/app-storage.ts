/** Configured-app data dispatch. Platform storage never holds authored rows. */
import { Effect, Schema, Stream } from "effect";
import type { AppDatabases } from "@executor-js/app-data";
import { bindAppStorage } from "./app-database.ts";
import { Json } from "../contracts/shared.ts";
import { HostOperationNotFound } from "apps/contracts";
import { AppDataFailed, AppDataNotFound, type AppDataInput } from "../contracts/app-data.ts";
import type { Runtime } from "../contracts/runtime.ts";
import type { ExecutorDatabase } from "./storage.ts";
import { database } from "./database.ts";
import { resolve, snapshot } from "./tools.ts";
import type { makeOAuth } from "./oauth.ts";

/** Bind data calls to fresh saved app/deployment/account selections. */
export const makeAppData = (
  storage: ExecutorDatabase,
  resolveAccount: ReturnType<typeof makeOAuth>["resolve"],
  runtime: Runtime,
  appStorage?: AppDatabases,
) => {
  const db = database(storage);
  const execute = (kind: "query" | "mutate", input: AppDataInput) =>
    Effect.gen(function* () {
      const state = yield* snapshot(db, input);
      const accounts = yield* resolve(state, resolveAccount);
      return yield* runtime[kind]({
        build: state.deployment.build,
        ...accounts,
        app: state.app.id,
        ...(yield* bindAppStorage(appStorage, state.app.id)),
        name: input.name,
        input: input.input,
      }).pipe(
        Effect.mapError((error) =>
          Schema.is(HostOperationNotFound)(error)
            ? new AppDataNotFound({ app: input.app, name: input.name })
            : new AppDataFailed({ app: input.app, name: input.name }),
        ),
      );
    });
  const changes = runtime.changes;
  return {
    subscribe: (input: AppDataInput) =>
      Effect.succeed(
        changes === undefined
          ? storage.reactivity.subscribe(execute("query", input))
          : Stream.merge(Stream.succeed(undefined), Stream.tick("15 seconds")).pipe(
              Stream.mapEffect(() => snapshot(db, input)),
              Stream.changesWith((a, b) => a.deployment.id === b.deployment.id),
              Stream.switchMap((state) =>
                Stream.merge(
                  state.deployment.requirements.database === undefined
                    ? Stream.succeed(undefined)
                    : changes(input.app).pipe(
                        Stream.mapError(
                          () => new AppDataFailed({ app: input.app, name: input.name }),
                        ),
                      ),
                  Stream.tick("15 seconds"),
                ),
              ),
              Stream.mapEffect(() => execute("query", input)),
              Stream.changesWith(Schema.toEquivalence(Json)),
              Stream.zipWithIndex,
              Stream.map(([value, revision]) => ({ value, revision })),
            ),
      ).pipe(Effect.withSpan("sdk.data.subscribe")),
    query: (input: AppDataInput) => execute("query", input).pipe(Effect.withSpan("sdk.data.query")),
    mutate: (input: AppDataInput) =>
      execute("mutate", input).pipe(Effect.withSpan("sdk.data.mutate")),
  };
};
