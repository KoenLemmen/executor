/** Native routes and a real Vite fallback exercise marketing, private redirects, assets and API proxying. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, Layer, Path } from "effect";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { developmentDashboard } from "../src/implementation/development-web.ts";
import { developmentRoutes } from "../scripts/development-web.ts";
import { marketingFiles } from "../src/implementation/marketing.ts";

test(
  "cloud dev keeps native homepage/marketing routes ahead of Vite and API proxy",
  { timeout: 60_000 },
  async () => {
    const backend = createServer((request, response) => {
      response.writeHead(request.url === "/api/check" ? 200 : 404, {
        "content-type": "application/json",
      });
      response.end(JSON.stringify({ api: true }));
    });
    await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
    try {
      const backendAddress = backend.address();
      assert.ok(backendAddress !== null && typeof backendAddress !== "string");
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const directory = yield* fs.makeTempDirectoryScoped();
            const dashboardRoot = path.join(directory, "dashboard");
            const publicRoot = path.join(directory, "marketing");
            yield* fs.makeDirectory(dashboardRoot);
            yield* fs.makeDirectory(path.join(publicRoot, "images"), { recursive: true });
            yield* fs.writeFileString(
              path.join(dashboardRoot, "index.html"),
              '<html><body>Dashboard<script type="module" src="/entry.js"></script></body></html>',
            );
            yield* fs.writeFileString(
              path.join(dashboardRoot, "entry.js"),
              'export const name = "dashboard"',
            );
            yield* fs.writeFileString(
              path.join(dashboardRoot, "vite.config.mjs"),
              `export default { server: { proxy: { "/api": "http://127.0.0.1:${backendAddress.port}" } } }`,
            );
            yield* fs.writeFileString(path.join(publicRoot, "index.html"), "<h1>Marketing</h1>");
            yield* fs.writeFileString(path.join(publicRoot, "about.html"), "<h1>About</h1>");
            yield* fs.writeFileString(path.join(publicRoot, "images/logo.svg"), "<svg></svg>");
            const socket = createServer();
            const hmrSocket = createServer();
            yield* Layer.build(
              NodeHttpServer.layerServer(() => hmrSocket, { host: "127.0.0.1", port: 0 }),
            );
            const hmrAddress = hmrSocket.address();
            assert.ok(hmrAddress !== null && typeof hmrAddress !== "string");
            let origin = "";
            const routes = Layer.unwrap(
              Effect.gen(function* () {
                const server = yield* HttpServer.HttpServer;
                assert.ok("port" in server.address);
                origin = `http://127.0.0.1:${server.address.port}`;
                const dashboard = yield* developmentDashboard(
                  dashboardRoot,
                  hmrSocket,
                  new URL(origin),
                );
                const marketing = yield* marketingFiles(publicRoot);
                return developmentRoutes(marketing, dashboard, "executor-cloud-dev");
              }),
            );
            yield* Layer.build(
              HttpRouter.serve(routes, { disableLogger: true, disableListenLog: true }).pipe(
                Layer.provide(
                  NodeHttpServer.layer(() => socket, {
                    host: "127.0.0.1",
                    port: 0,
                    gracefulShutdownTimeout: 1_000,
                  }),
                ),
              ),
            );
            yield* Effect.addFinalizer(() => Effect.sync(() => socket.closeAllConnections()));
            yield* Effect.promise(async () => {
              for (const pathname of ["/", "/home", "/home/"]) {
                const page = await fetch(origin + pathname);
                assert.equal(page.status, 200);
                assert.match(await page.text(), /Marketing/);
              }
              const privatePage = await fetch(origin, {
                redirect: "manual",
                headers: { cookie: "executor-cloud-dev.session_token=synthetic" },
              });
              assert.equal(privatePage.status, 200);
              assert.equal(privatePage.headers.get("location"), null);
              assert.equal(privatePage.headers.get("cache-control"), "private, no-store");
              assert.equal(privatePage.headers.get("vary"), "Cookie");
              assert.match(await privatePage.text(), /Dashboard/);
              const head = await fetch(origin, {
                method: "HEAD",
                redirect: "manual",
                headers: { cookie: "executor-cloud-dev.session_token=synthetic" },
              });
              assert.equal(head.status, 200);
              assert.equal(await head.text(), "");
              assert.match(await (await fetch(origin + "/about")).text(), /About/);
              assert.match(await (await fetch(origin + "/about.html")).text(), /About/);
              assert.equal((await fetch(origin + "/images/logo.svg")).status, 200);
              assert.equal((await fetch(origin + "/images/missing.svg")).status, 404);
              assert.match(await (await fetch(origin + "/login")).text(), /Dashboard/);
              const script = await fetch(origin + "/entry.js");
              assert.equal(script.status, 200);
              assert.match(await script.text(), /dashboard/);
              const client = await (await fetch(origin + "/@vite/client")).text();
              const token = /const wsToken = "([^"]+)"/.exec(client)?.[1];
              assert.ok(token, "Vite must publish its HMR client token");
              const hmr = new WebSocket(
                `ws://127.0.0.1:${hmrAddress.port}/?token=${encodeURIComponent(token)}`,
                "vite-hmr",
              );
              try {
                await new Promise<void>((resolve, reject) => {
                  const timer = setTimeout(
                    () => reject(new Error("HMR handshake timed out")),
                    5_000,
                  );
                  hmr.addEventListener(
                    "message",
                    (event) => {
                      clearTimeout(timer);
                      try {
                        assert.deepEqual(JSON.parse(String(event.data)), { type: "connected" });
                        resolve();
                      } catch (error) {
                        reject(error);
                      }
                    },
                    { once: true },
                  );
                  hmr.addEventListener(
                    "error",
                    () => {
                      clearTimeout(timer);
                      reject(new Error("HMR connection failed"));
                    },
                    { once: true },
                  );
                });
              } finally {
                hmr.close();
              }
              const api = await fetch(origin + "/api/check", { method: "POST" });
              assert.equal(api.status, 200);
              assert.deepEqual(await api.json(), { api: true });
              const missing = await fetch(origin + "/api/missing", {
                headers: { accept: "text/html" },
              });
              assert.equal(missing.status, 404);
              assert.deepEqual(await missing.json(), { api: true });
            });
          }),
        ).pipe(Effect.provide(NodeServices.layer)),
      );
    } finally {
      await new Promise<void>((resolve) => {
        backend.close(() => resolve());
        backend.closeAllConnections();
      });
    }
  },
);
