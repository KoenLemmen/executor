/** Real Postgres admin sessions with a controlled Cloudflare HTTP boundary. See notes/test-stages.md. */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Client } from "pg";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Command } from "effect/unstable/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { testStageCommand } from "../src/implementation/test-stage-commands.ts";
import { ConfigProvider, Effect } from "effect";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { withStageAdmin } from "../src/implementation/test-stage-inventory.ts";

const connectionString =
  "postgresql://admin.fixture:synthetic-test-password@127.0.0.1:5432/postgres";
const admin = new Client({ connectionString });
const config = ConfigProvider.fromUnknown({
  TEST_STAGE_DATABASE_ADMIN_URL: connectionString,
  CLOUDFLARE_ACCOUNT_ID: "fixture",
  CLOUDFLARE_API_TOKEN: "synthetic-token",
});
const pool = (name: string, database: string, user = "runtime.fixture") => ({
  name,
  origin: { host: "127.0.0.1", user, database },
  origin_connection_limit: 5,
});
const pages: number[] = [];
const http = HttpClient.make((request, url) => {
  const page = Number(url.searchParams.get("page"));
  pages.push(page);
  const result =
    page === 1
      ? [
          pool("first", "executor_fixture_one"),
          pool("other-branch", "executor_ignored", "runtime.other"),
        ]
      : [pool("orphan", "executor_fixture_orphan"), pool("other-database", "postgres")];
  return Effect.succeed(
    HttpClientResponse.fromWeb(
      request,
      Response.json({ success: true, result, result_info: { total_pages: 2 } }),
    ),
  );
});
const run = <A, E>(effect: Effect.Effect<A, E, HttpClient.HttpClient>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provideService(ConfigProvider.ConfigProvider, config),
      Effect.provideService(HttpClient.HttpClient, http),
    ),
  );

before(async () => {
  await admin.connect();
  for (const database of ["executor_fixture_one", "executor_fixture_pending"])
    await admin.query(`create database ${database}`);
});
after(async () => {
  for (const database of ["executor_fixture_one", "executor_fixture_pending"])
    await admin.query(`drop database if exists ${database} with (force)`);
  await admin.end();
});

test("inventory reads all pages and includes databases without pools and pools without databases", async () => {
  const result = await run(withStageAdmin(false, (session) => session.inventory));
  assert.deepEqual(pages, [1, 2]);
  assert.deepEqual(
    result.stages.map((stage) => stage.slug),
    ["fixture-one", "fixture-orphan", "fixture-pending"],
  );
  assert.equal(result.otherPools.length, 1);
  assert.equal(result.maxConnections, 100);
  assert.equal(result.stages[0]?.retention, null);
  assert.ok(!JSON.stringify(result).includes("synthetic-token"));
});

test("keep and expiry persist in the actual database comment without changing data", async () => {
  const kept = {
    version: 1 as const,
    owner: "fixture",
    updatedAt: "2026-01-01T00:00:00Z",
    expiresAt: null,
  };
  await run(withStageAdmin(true, (session) => session.writeRetention("fixture-one", kept)));
  const result = await run(withStageAdmin(false, (session) => session.inventory));
  assert.deepEqual(result.stages.find((stage) => stage.slug === "fixture-one")?.retention, kept);
  const expiring = { ...kept, owner: "fixture's owner", expiresAt: "2026-01-03T00:00:00Z" };
  await run(withStageAdmin(true, (session) => session.writeRetention("fixture-one", expiring)));
  const updated = await run(withStageAdmin(false, (session) => session.inventory));
  assert.deepEqual(
    updated.stages.find((stage) => stage.slug === "fixture-one")?.retention,
    expiring,
  );
});

test("unowned comments are preserved", async () => {
  await admin.query("comment on database executor_fixture_pending is 'owned elsewhere'");
  await assert.rejects(
    run(
      withStageAdmin(true, (session) =>
        session.writeRetention("fixture-pending", {
          version: 1,
          owner: "fixture",
          updatedAt: "2026-01-01T00:00:00Z",
          expiresAt: null,
        }),
      ),
    ),
    /comment was preserved/,
  );
  const { rows } = await admin.query(
    "select shobj_description(oid, 'pg_database') as comment from pg_database where datname = 'executor_fixture_pending'",
  );
  assert.equal(rows[0].comment, "owned elsewhere");
});

test("a concurrent command cannot pass the deployment lock, and interruption releases it", async () => {
  let acquired: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    acquired = resolve;
  });
  const cancellation = new AbortController();
  const first = Effect.runPromise(
    withStageAdmin(true, () => Effect.sync(acquired).pipe(Effect.andThen(Effect.never))).pipe(
      Effect.provideService(ConfigProvider.ConfigProvider, config),
    ),
    { signal: cancellation.signal },
  );
  // Attach immediately so intentional interruption never becomes an unhandled rejection.
  const finished = first.catch(() => undefined);
  await ready;
  await assert.rejects(run(withStageAdmin(true, () => Effect.void)), /Another test-stage command/);
  cancellation.abort();
  await finished;
  await run(withStageAdmin(true, () => Effect.void));
});

test("losing the lock's database session interrupts the work", async () => {
  await assert.rejects(
    run(
      withStageAdmin(true, () =>
        Effect.promise(async () => {
          await admin.query(
            "select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'executor-test-stage'",
          );
        }).pipe(Effect.andThen(Effect.never)),
      ),
    ),
    /connection closed/,
  );
  await run(withStageAdmin(true, () => Effect.void));
});

/** Child execution remains real, but build/deploy executables stop at this controlled adapter. */
const runCommand = (
  args: readonly string[],
  exitCodes: { readonly build: number; readonly alchemy: number },
  client = http,
) => {
  const commands: ChildProcess.StandardCommand[] = [];
  const result = Effect.runPromise(
    Effect.gen(function* () {
      const native = yield* ChildProcessSpawner.ChildProcessSpawner;
      const controlled = ChildProcessSpawner.make((command) => {
        assert.ok(ChildProcess.isStandardCommand(command));
        commands.push(command);
        switch (command.command) {
          case "git":
            return native.spawn(command);
          case "bun":
            return native.spawn(
              ChildProcess.make(process.execPath, ["-e", `process.exit(${exitCodes.build})`]),
            );
          case "alchemy":
            return native.spawn(
              ChildProcess.make(process.execPath, ["-e", `process.exit(${exitCodes.alchemy})`]),
            );
          default:
            return Effect.die(new Error("Unexpected executable in test"));
        }
      });
      return yield* Command.runWith(testStageCommand, { version: "0.0.0", renderErrors: false })(
        args,
      ).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, controlled),
        Effect.provideService(ConfigProvider.ConfigProvider, config),
        Effect.provideService(HttpClient.HttpClient, client),
      );
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
  return { result, commands };
};

test("CLI forwards the selected stage and Alchemy flags, then records retention", async () => {
  const { result, commands } = runCommand(
    ["deploy", "fixture-one", "--no-input", "--yes", "--owner", "cli-fixture", "--days", "2"],
    { build: 0, alchemy: 0 },
  );
  await result;
  const alchemy = commands.find((command) => command.command === "alchemy");
  assert.deepEqual(alchemy?.args, ["deploy", "--no-input", "--yes"]);
  assert.equal(alchemy?.options.env?.ALCHEMY_STAGE, "test-fixture-one");
  const report = await run(withStageAdmin(false, (session) => session.inventory));
  assert.equal(
    report.stages.find((stage) => stage.slug === "fixture-one")?.retention?.owner,
    "cli-fixture",
  );
});

test("failed builds cannot start Alchemy; failed deployments do not refresh retention", async () => {
  const first = runCommand(["deploy", "fixture-one", "--owner", "failed"], {
    build: 23,
    alchemy: 0,
  });
  await assert.rejects(first.result, /status 23/);
  assert.ok(!first.commands.some((command) => command.command === "alchemy"));
  const second = runCommand(["deploy", "fixture-one", "--owner", "failed"], {
    build: 0,
    alchemy: 24,
  });
  await assert.rejects(second.result, /status 24/);
  const report = await run(withStageAdmin(false, (session) => session.inventory));
  assert.equal(
    report.stages.find((stage) => stage.slug === "fixture-one")?.retention?.owner,
    "cli-fixture",
  );
});

test("capacity failures stop before any child command, but destruction stays available", async () => {
  const high = HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        Response.json({
          success: true,
          result: [{ ...pool("large", "executor_fixture_one"), origin_connection_limit: 99 }],
        }),
      ),
    ),
  );
  const blocked = runCommand(
    ["deploy", "new", "--owner", "fixture"],
    { build: 0, alchemy: 0 },
    high,
  );
  await assert.rejects(blocked.result, /No build or infrastructure changes/);
  assert.equal(blocked.commands.length, 0);
  const unavailable = HttpClient.make((request) =>
    Effect.succeed(
      HttpClientResponse.fromWeb(request, new Response("Unavailable", { status: 503 })),
    ),
  );
  const removal = runCommand(
    ["destroy", "fixture-one", "--no-input", "--yes"],
    { build: 0, alchemy: 0 },
    unavailable,
  );
  await removal.result;
  assert.deepEqual(removal.commands.find((command) => command.command === "alchemy")?.args, [
    "destroy",
    "--no-input",
    "--yes",
  ]);
});

test("a caller cannot override the stage checked by the guard through Alchemy arguments", async () => {
  const { result, commands } = runCommand(["deploy", "fixture-one", "--", "--stage", "v2"], {
    build: 0,
    alchemy: 0,
  });
  await assert.rejects(result);
  assert.equal(commands.length, 0);
});

test("check exits nonzero at the configured warning threshold", async () => {
  const previous = process.exitCode;
  try {
    const high = HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          Response.json({
            success: true,
            result: [{ ...pool("large", "executor_fixture_one"), origin_connection_limit: 99 }],
          }),
        ),
      ),
    );
    const { result, commands } = runCommand(["check", "--json"], { build: 0, alchemy: 0 }, high);
    await result;
    assert.equal(process.exitCode, 1);
    assert.equal(commands.length, 0);
  } finally {
    process.exitCode = previous;
  }
});
