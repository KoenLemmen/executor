/** Workerd edge: one supervisor per configured app; code changes preserve the isolated facet database. */
import { WorkerBundle, workerModules } from "./contracts/worker-bundle.ts";
import type { DurableObjectState, WorkerLoader, WebSocket } from "@cloudflare/workers-types";
import { Clock, Deferred, Effect, Result, Schema, Semaphore } from "effect";
import { fingerprint } from "./implementation/cursor.ts";
import { AppDatabaseError } from "./contracts/database.ts";

/** Executable bytes, supplied by the trusted build store rather than a browser request. */
export const FacetBundle = WorkerBundle;
/** The outer host has already authorized this exact app invocation. No credentials are persisted here. */
export const FacetInvocation = Schema.Struct({
  id: Schema.NonEmptyString,
  identity: Schema.NonEmptyString,
  bundle: FacetBundle,
  body: Schema.String,
  write: Schema.Boolean,
  headers: Schema.Record(Schema.String, Schema.String),
});
const causes = new WeakMap<AppDatabaseError, unknown>();
/** Internal diagnostics, deliberately absent from the serialized error. */
export const facetFailureCause = (error: AppDatabaseError): unknown => causes.get(error);
const failed = (cause?: unknown) => {
  const error = new AppDatabaseError({ reason: "storage" });
  causes.set(error, cause);
  return error;
};

/** Private per-call cancellation; the facet never receives the supervisor storage or namespace. */
const FacetEntrypoint = Schema.declare(
  (
    value,
  ): value is {
    invoke: (
      id: string,
      body: string,
      headers: Readonly<Record<string, string>>,
      elicitation: ((input: unknown) => Promise<unknown>) | null,
    ) => Promise<unknown>;
    cancel: (id: string) => Promise<void>;
  } =>
    typeof value === "object" &&
    value !== null &&
    "invoke" in value &&
    typeof value.invoke === "function" &&
    "cancel" in value &&
    typeof value.cancel === "function",
);

/** Use supervisor alarms: the pinned workerd cannot schedule alarms from a facet. */
export const makeFacetSupervisor = (state: DurableObjectState, loader: Pick<WorkerLoader, "get">) =>
  Effect.gen(function* () {
    const lifecycle = yield* Semaphore.make(1);
    const metadata = yield* Semaphore.make(1);
    type Context = {
      identity: string;
      users: number;
      drained: Deferred.Deferred<void>;
    };
    let active: Context | undefined;
    let writes = 0;
    const calls = new Map<
      string,
      { cancel: Deferred.Deferred<void>; done: Deferred.Deferred<void> }
    >();
    const acquire = (invocation: typeof FacetInvocation.Type) =>
      lifecycle.withPermits(1)(
        Effect.gen(function* () {
          if (active !== undefined && active.identity !== invocation.identity && active.users > 0) {
            // Await only our lease queue. The DO remains free to deliver RPC callbacks, cancellation and alarms.
            yield* Deferred.await(active.drained);
          }
          if (active === undefined || active.identity !== invocation.identity) {
            yield* Effect.try({
              try: () => state.facets.abort("data", "Execution context changed"),
              catch: failed,
            });
            active = {
              identity: invocation.identity,
              users: 0,
              drained: yield* Deferred.make<void>(),
            };
          }
          // Facet abort/reset invalidates stubs. Reacquire the capability on each call;
          // get() keeps the existing instance when it is healthy and restarts it otherwise.
          const entrypoint = yield* Effect.try({
            try: () =>
              Schema.decodeUnknownSync(FacetEntrypoint)(
                state.facets.get("data", () => {
                  const worker = loader.get(
                    `${state.id.toString()}:${invocation.identity}`,
                    () => ({
                      ...invocation.bundle,
                      modules: workerModules(invocation.bundle.modules),
                      compatibilityDate: "2026-07-30",
                      // Same-zone URLs must use their public Worker routes, not the underlying origin.
                      compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
                    }),
                  );
                  return { class: worker.getDurableObjectClass("ExecutorAppData") };
                }),
              ),
            catch: failed,
          });
          if (active.users === 0) active.drained = yield* Deferred.make<void>();
          const context = active;
          return yield* Effect.acquireRelease(
            Effect.sync(() => {
              context.users++;
              return { context, entrypoint };
            }),
            ({ context }) => release(context),
          );
        }),
      );
    const release = (lease: Context) =>
      Effect.gen(function* () {
        lease.users--;
        if (lease.users === 0) yield* Deferred.succeed(lease.drained, undefined);
      });
    const revision = Effect.tryPromise({
      try: () => state.storage.get("revision"),
      catch: failed,
    }).pipe(
      Effect.flatMap((value) =>
        value === undefined
          ? Effect.succeed(0)
          : Schema.decodeUnknownEffect(Schema.Int)(value).pipe(Effect.mapError(failed)),
      ),
    );
    const pending = Effect.tryPromise({
      try: () => state.storage.get("pending"),
      catch: failed,
    }).pipe(
      Effect.flatMap((value) =>
        value === undefined
          ? Effect.succeed(false)
          : Schema.decodeUnknownEffect(Schema.Boolean)(value).pipe(Effect.mapError(failed)),
      ),
    );
    const arm = Effect.flatMap(Clock.currentTimeMillis, (now) =>
      Effect.tryPromise({ try: () => state.storage.setAlarm(now + 1_000), catch: failed }),
    );
    const send = (socket: WebSocket, value: number) => {
      socket.send(JSON.stringify({ revision: value }));
      socket.serializeAttachment({ revision: value });
    };
    const notify = (value: number) =>
      Effect.try({
        try: () => {
          for (const socket of state.getWebSockets()) {
            const attachment = Schema.decodeUnknownSync(
              Schema.NullOr(Schema.Struct({ revision: Schema.Int })),
            )(socket.deserializeAttachment());
            if (attachment === null || attachment.revision < value) send(socket, value);
          }
        },
        catch: failed,
      });
    const begin = metadata.withPermits(1)(
      Effect.gen(function* () {
        yield* arm;
        yield* Effect.tryPromise({ try: () => state.storage.put("pending", true), catch: failed });
        writes++;
      }),
    );
    const finish = metadata.withPermits(1)(
      Effect.gen(function* () {
        writes--;
        const next = (yield* revision) + 1;
        yield* Effect.tryPromise({
          try: () => state.storage.put({ revision: next, pending: writes > 0 }),
          catch: failed,
        });
        yield* notify(next);
        if (writes === 0)
          yield* Effect.tryPromise({ try: () => state.storage.deleteAlarm(), catch: failed });
      }),
    );
    const recover = metadata.withPermits(1)(
      Effect.gen(function* () {
        if (writes > 0) return yield* arm;
        if (yield* pending) {
          const next = (yield* revision) + 1;
          yield* Effect.tryPromise({
            try: () => state.storage.put({ revision: next, pending: false }),
            catch: failed,
          });
        }
        yield* notify(yield* revision);
        yield* Effect.tryPromise({ try: () => state.storage.deleteAlarm(), catch: failed });
      }),
    );
    const invoke = (
      invocation: typeof FacetInvocation.Type,
      elicitation: ((input: unknown) => Promise<unknown>) | null,
    ) =>
      Effect.scoped(
        Effect.gen(function* () {
          const lease = yield* acquire(invocation);
          if (invocation.write)
            yield* Effect.acquireRelease(begin, () => finish.pipe(Effect.catch(() => Effect.void)));
          const run = Effect.gen(function* () {
            const call = yield* Effect.acquireRelease(
              Effect.sync(() => {
                const id = invocation.id;
                const result = Promise.resolve()
                  .then(() =>
                    lease.entrypoint.invoke(id, invocation.body, invocation.headers, elicitation),
                  )
                  .then(Result.succeed, Result.fail);
                return { id, result };
              }),
              ({ id, result }) =>
                Effect.promise(async () => {
                  // Keep the generation leased until cancellation has closed its transaction and callback scopes.
                  await Promise.allSettled([
                    Promise.resolve().then(() => lease.entrypoint.cancel(id)),
                    result,
                  ]);
                }),
            );
            const result = yield* Effect.promise(() => call.result);
            if (Result.isFailure(result)) return yield* failed(result.failure);
            return yield* Schema.decodeUnknownEffect(Schema.Json)(result.success).pipe(
              Effect.mapError(failed),
            );
          });
          return yield* run;
        }),
      );
    return {
      invoke: (
        input: typeof FacetInvocation.Type,
        elicitation: ((input: unknown) => Promise<unknown>) | null = null,
      ) =>
        Effect.scoped(
          Effect.gen(function* () {
            const invocation = yield* Schema.decodeUnknownEffect(Schema.toType(FacetInvocation))(
              input,
            ).pipe(Effect.mapError(failed));
            const handle = {
              cancel: yield* Deferred.make<void>(),
              done: yield* Deferred.make<void>(),
            };
            if (calls.has(invocation.id)) return yield* failed();
            yield* Effect.acquireRelease(
              Effect.sync(() => {
                calls.set(invocation.id, handle);
              }),
              () =>
                Effect.gen(function* () {
                  calls.delete(invocation.id);
                  yield* Deferred.succeed(handle.done, undefined);
                }),
            );
            return yield* Effect.raceFirst(
              invoke(invocation, elicitation),
              Deferred.await(handle.cancel).pipe(Effect.andThen(Effect.interrupt)),
            );
          }),
        ),
      cancel: (id: string) =>
        Effect.gen(function* () {
          const handle = calls.get(id);
          if (handle === undefined) return;
          yield* Deferred.succeed(handle.cancel, undefined);
          yield* Deferred.await(handle.done);
        }),
      initial: (socket: WebSocket) =>
        metadata.withPermits(1)(
          Effect.flatMap(revision, (current) =>
            Effect.try({ try: () => send(socket, current), catch: failed }),
          ),
        ),
      subscribe: (socket: WebSocket) =>
        metadata.withPermits(1)(
          Effect.gen(function* () {
            const current = yield* revision;
            yield* Effect.try({
              try: () => {
                state.acceptWebSocket(socket);
                send(socket, current);
              },
              catch: failed,
            });
          }),
        ),
      recover,
    };
  });

/** A deployment and the host-serialized account bindings define one warm execution context. */
export const facetIdentity = (build: string, accounts: string) =>
  fingerprint(crypto, JSON.stringify([build, accounts]));
