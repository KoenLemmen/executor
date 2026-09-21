/** Internal notification transport. Sockets carry only app revisions; product routes authorize every delivered result. */
import type { DurableObjectNamespace } from "@cloudflare/workers-types";
import { Cause, Effect, Queue, Stream } from "effect";
import { RuntimeProtocolFailed } from "@executor-js/sdk/core";

/** Register before the initial read, conflate bursts, and close with the subscriber's scope. */
export const dataChanges = (namespace: Pick<DurableObjectNamespace, "getByName">, app: string) =>
  Stream.callback<void, RuntimeProtocolFailed>(
    (queue) =>
      Effect.gen(function* () {
        const socket = yield* Effect.acquireRelease(
          Effect.tryPromise({
            try: async () => {
              const response = await namespace
                .getByName(app)
                .fetch("https://app.internal/changes", { headers: { Upgrade: "websocket" } });
              if (response.status !== 101 || response.webSocket === null)
                throw new Error("Subscription unavailable");
              return response.webSocket;
            },
            catch: () => new RuntimeProtocolFailed(),
          }),
          (socket) => Effect.sync(() => socket.close(1000, "Subscription ended")),
        );
        const changed = () => {
          Queue.offerUnsafe(queue, undefined);
        };
        const closed = () => {
          Queue.failCauseUnsafe(queue, Cause.fail(new RuntimeProtocolFailed()));
        };
        socket.addEventListener("message", changed);
        socket.addEventListener("close", closed);
        socket.addEventListener("error", closed);
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            socket.removeEventListener("message", changed);
            socket.removeEventListener("close", closed);
            socket.removeEventListener("error", closed);
          }),
        );
        socket.accept();
      }),
    { bufferSize: 1, strategy: "sliding" },
  );
