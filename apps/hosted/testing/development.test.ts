/** Local role shortcuts must issue real sessions without becoming a production auth route. */
import assert from "node:assert/strict";
import { test } from "node:test";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Authentication } from "@executor-js/hosted-server";
import { ConfigProvider, Effect, Exit, FileSystem, Layer, Schema } from "effect";
import { DevtoolsState } from "@executor-js/devtools/contracts";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { selfHostDatabase } from "../self-host/src/database.ts";
import { selfHostAuth } from "../self-host/src/auth.ts";
import { developmentSettings, developmentSignIn } from "./development.ts";

const origin = "http://member-test.localhost:55453";
const settings = {
  NODE_ENV: "test",
  BETTER_AUTH_URL: origin,
  BETTER_AUTH_SECRET: "synthetic-development-signing-secret-1234",
  EXECUTOR_DATA_DIR: "unused",
};

test("test server refuses production mode, public targets, and HTTPS it cannot serve", async () => {
  for (const overrides of [
    { NODE_ENV: "production" },
    { BETTER_AUTH_URL: "http://example.com:4400" },
    { BETTER_AUTH_URL: "https://member-test.localhost:4400" },
  ]) {
    const result = await Effect.runPromise(
      Effect.exit(
        developmentSettings.pipe(
          Effect.provideService(
            ConfigProvider.ConfigProvider,
            ConfigProvider.fromUnknown({ ...settings, ...overrides }),
          ),
        ),
      ),
    );
    assert.ok(Exit.isFailure(result));
  }
});

test("role picker uses same-origin POSTs, refreshes sessions, and stays absent from normal auth", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped();
        yield* Effect.gen(function* () {
          const target = yield* developmentSettings;
          const dev = yield* developmentSignIn(target, "agent-tests");
          const native = yield* selfHostAuth;
          const web = yield* Effect.acquireRelease(
            Effect.sync(() =>
              HttpRouter.toWebHandler(
                Layer.mergeAll(
                  HttpRouter.add("GET", "/api/devtools", dev.status),
                  HttpRouter.add("POST", "/api/devtools/account", dev.signIn),
                  HttpRouter.add("*", "/api/auth/*", native.handler),
                ).pipe(Layer.provide(HttpServer.layerServices)),
                { disableLogger: true },
              ),
            ),
            (web) => Effect.promise(() => web.dispose()),
          );
          const request = (path: string, body?: unknown, headers?: Record<string, string>) =>
            Effect.promise(() =>
              web.handler(
                new Request(origin + path, {
                  method: body === undefined ? "GET" : "POST",
                  headers: {
                    host: new URL(origin).host,
                    origin,
                    "content-type": "application/json",
                    ...headers,
                  },
                  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
                }),
              ),
            );
          const configuration = yield* request("/api/devtools");
          const publicConfig = yield* Effect.promise(() => configuration.json()).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(DevtoolsState)),
          );
          assert.ok(publicConfig.kind === "accounts");
          assert.deepEqual(
            publicConfig.accounts.map((account) => account.role),
            ["member", "admin", "owner"],
          );
          const endpoint = "/api/devtools/account";
          assert.equal(
            (yield* request(endpoint, { role: "member" }, { origin: "https://example.com" }))
              .status,
            403,
          );
          assert.equal(
            (yield* request(endpoint, { role: "member" }, { host: "rebinding.example.com:55453" }))
              .status,
            403,
          );
          assert.equal((yield* request(endpoint, { role: "superadmin" })).status, 400);
          assert.equal((yield* request(endpoint)).headers.get("set-cookie"), null);
          const first = yield* request(endpoint, { role: "member" });
          const second = yield* request(endpoint, { role: "member" });
          assert.equal(first.status, 200);
          assert.equal(second.status, 200);
          const cookie = Schema.decodeUnknownSync(Schema.NonEmptyString)(
            first.headers.getSetCookie()[0],
          );
          assert.ok(cookie.includes("HttpOnly"));
          assert.notEqual(second.headers.get("set-cookie"), first.headers.get("set-cookie"));
          const headers = new Headers({
            cookie: Schema.decodeUnknownSync(Schema.NonEmptyString)(cookie.split(";")[0]),
          });
          const active = yield* request("/api/devtools", undefined, {
            cookie: Schema.decodeUnknownSync(Schema.NonEmptyString)(headers.get("cookie")),
          });
          const activeState = yield* Effect.promise(() => active.json()).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(DevtoolsState)),
          );
          assert.ok(activeState.kind === "accounts");
          assert.equal(activeState.selected, "member");
          yield* Effect.gen(function* () {
            const auth = yield* Authentication;
            assert.ok(yield* auth.current(headers));
          }).pipe(Effect.provide(native.identity));
          const normal = yield* Effect.acquireRelease(
            Effect.sync(() =>
              HttpRouter.toWebHandler(
                HttpRouter.add("*", "/api/auth/*", native.handler).pipe(
                  Layer.provide(HttpServer.layerServices),
                ),
                { disableLogger: true },
              ),
            ),
            (web) => Effect.promise(() => web.dispose()),
          );
          const normalConfig = yield* Effect.promise(() =>
            normal.handler(new Request(origin + "/api/auth/self-host/config")),
          );
          assert.deepEqual(yield* Effect.promise(() => normalConfig.json()), {
            setup: false,
            sso: false,
          });
          const denied = yield* Effect.promise(() =>
            normal.handler(
              new Request(origin + endpoint, {
                method: "POST",
                headers: { origin, "content-type": "application/json" },
                body: JSON.stringify({ role: "owner" }),
              }),
            ),
          );
          assert.equal(denied.status, 404);
          assert.equal(denied.headers.get("set-cookie"), null);
        }).pipe(
          Effect.provide(selfHostDatabase),
          Effect.provideService(
            ConfigProvider.ConfigProvider,
            ConfigProvider.fromUnknown({ ...settings, EXECUTOR_DATA_DIR: directory }),
          ),
        );
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  ));
