/** Trace the real PostgreSQL driver against a synthetic TCP startup peer. */
import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";
import { test } from "node:test";
import { PgConnection, PgPool } from "@effect/sql-pg";
import { Cause, Deferred, Effect, Exit, Match, Option, Redacted, Schema, Tracer } from "effect";
import { SqlError } from "effect/unstable/sql/SqlError";

const ready = (socket: Socket, processId: number) => {
  const key = Buffer.alloc(13);
  key.writeUInt8(75);
  key.writeInt32BE(12, 1);
  key.writeInt32BE(processId, 5);
  socket.write(
    Buffer.concat([
      Buffer.from([82, 0, 0, 0, 8, 0, 0, 0, 0]), // AuthenticationOk
      key,
      Buffer.from([90, 0, 0, 0, 5, 73]), // ReadyForQuery, idle
    ]),
  );
};

const withPeer = async (
  respond: (socket: Socket, processId: number) => void,
  run: (peer: {
    readonly options: PgConnection.Config;
    readonly started: Effect.Effect<void>;
    readonly closed: Effect.Effect<void>;
    readonly connections: () => number;
  }) => Promise<void>,
) => {
  const sockets = new Set<Socket>();
  const started = Deferred.makeUnsafe<void>();
  const closed = Deferred.makeUnsafe<void>();
  let connections = 0;
  const server = createServer((socket) => {
    const processId = ++connections;
    sockets.add(socket);
    socket.on("error", () => {});
    socket.once("close", () => {
      sockets.delete(socket);
      Deferred.doneUnsafe(closed, Effect.void);
    });
    let input = Buffer.alloc(0);
    const startup = (chunk: Buffer) => {
      input = Buffer.concat([input, chunk]);
      if (input.length < 4 || input.length < input.readInt32BE(0)) return;
      socket.off("data", startup);
      Deferred.doneUnsafe(started, Effect.void);
      respond(socket, processId);
    };
    socket.on("data", startup);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    assert.ok(address !== null && typeof address !== "string");
    await run({
      options: {
        host: "127.0.0.1",
        port: address.port,
        username: "synthetic-user",
        password: Redacted.make("synthetic-password"),
        database: "synthetic-database",
        ssl: false,
        prepare: false,
      },
      started: Deferred.await(started),
      closed: Deferred.await(closed),
      connections: () => connections,
    });
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error === undefined ? resolve() : reject(error))),
    );
  }
};

const recording = () => {
  const spans: Tracer.NativeSpan[] = [];
  return {
    spans,
    tracer: Tracer.make({
      span: (options) => {
        const span = new Tracer.NativeSpan(options);
        spans.push(span);
        return span;
      },
    }),
    connections: () => spans.filter((span) => span.name === "sql.connect"),
  };
};

const outcome = (span: Tracer.NativeSpan) =>
  Match.value(span.status).pipe(
    Match.tag("Ended", (status) => ({ exit: status.exit })),
    Match.tag("Started", () => assert.fail("Connection span did not end")),
    Match.exhaustive,
  ).exit;

test("physical connection spans preserve lazy pool reuse and replacement", { timeout: 5_000 }, () =>
  withPeer(ready, async (peer) => {
    const trace = recording();
    await Effect.runPromise(
      Effect.gen(function* () {
        const pool = yield* PgPool.make({ ...peer.options, maxConnections: 1 });
        assert.equal(peer.connections(), 0);
        assert.equal(trace.connections().length, 0);
        const first = yield* Effect.scoped(pool.get);
        const connected = trace.connections()[0];
        assert.ok(connected);
        assert.ok(Exit.isSuccess(outcome(connected)));
        const reused = yield* Effect.scoped(pool.get);
        assert.equal(reused.processId, first.processId);
        assert.equal(trace.connections().length, 1);
        yield* pool.invalidate(first);
        const replacement = yield* Effect.scoped(pool.get);
        assert.notEqual(replacement.processId, first.processId);
        assert.equal(peer.connections(), 2);
      }).pipe(
        Effect.scoped,
        Effect.withSpan("fixture.read"),
        Effect.provideService(Tracer.Tracer, trace.tracer),
      ),
    );
    const parent = trace.spans.find((span) => span.name === "fixture.read");
    assert.ok(parent);
    assert.equal(trace.connections().length, 2);
    for (const span of trace.connections()) {
      assert.ok(Exit.isSuccess(outcome(span)));
      assert.equal(span.kind, "client");
      assert.equal(Option.getOrUndefined(span.parent)?.spanId, parent.spanId);
      assert.deepEqual([...span.attributes], []);
    }
  }),
);

test(
  "failed connection spans preserve the driver error without connection attributes",
  { timeout: 5_000 },
  () =>
    withPeer(
      (socket) => socket.end(),
      async (peer) => {
        const trace = recording();
        const result = await Effect.runPromiseExit(
          PgConnection.make(peer.options).pipe(
            Effect.scoped,
            Effect.provideService(Tracer.Tracer, trace.tracer),
          ),
        );
        assert.ok(Exit.isFailure(result));
        assert.ok(Schema.is(SqlError)(Cause.squash(result.cause)));
        const span = trace.connections()[0];
        assert.ok(span);
        assert.equal(trace.connections().length, 1);
        const exit = outcome(span);
        assert.ok(Exit.isFailure(exit));
        assert.equal(Cause.squash(exit.cause), Cause.squash(result.cause));
        assert.deepEqual([...span.attributes], []);
      },
    ),
);

test("cancelled connection spans end and release the pending socket", { timeout: 5_000 }, () =>
  withPeer(
    () => {},
    async (peer) => {
      const trace = recording();
      const controller = new AbortController();
      const pending = Effect.runPromiseExit(
        PgConnection.make(peer.options).pipe(
          Effect.scoped,
          Effect.provideService(Tracer.Tracer, trace.tracer),
        ),
        { signal: controller.signal },
      );
      await Effect.runPromise(peer.started);
      controller.abort();
      const result = await pending;
      await Effect.runPromise(peer.closed);
      assert.ok(Exit.isFailure(result) && Cause.hasInterruptsOnly(result.cause));
      const span = trace.connections()[0];
      assert.ok(span);
      const exit = outcome(span);
      assert.ok(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause));
      assert.deepEqual([...span.attributes], []);
    },
  ),
);
