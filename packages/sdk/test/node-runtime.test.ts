/** Optional framework peers resolve from each retained app installation. */
import assert from "node:assert/strict";
import { test } from "node:test";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, Path, Redacted, Schema } from "effect";
import { HostToolNotFound, HostOperationNotFound } from "apps/contracts";
import { SourceFiles } from "../src/contracts/deployment.ts";
import { nodeRuntime } from "@executor-js/sdk/node";
import { toEffectRuntime } from "@executor-js/sdk/core";
import { memoryBlobStore } from "@executor-js/sdk/blobs";

const appSource = (
  imports: string,
  description: string,
  result = '"ok"',
) => `import { defineApp, object, mutation } from "apps";
${imports};
export default defineApp({ accounts: {} }, async () => ({
    name: "Dependency fixture",
    mutations: { info: mutation({ description: ${description}, input: object({}) }, async () => ${result}) },
}));
`;
const files = (content: string, dependencies?: Readonly<Record<string, string>>) =>
  Schema.decodeUnknownSync(SourceFiles)([
    { path: "index.ts", content },
    ...(dependencies === undefined
      ? []
      : [{ path: "package.json", content: JSON.stringify({ dependencies }) }]),
  ]);

for (const fixture of [
  { name: "root", imports: "", description: '"Root"', dependencies: {} },
  {
    name: "HTTP MCP",
    imports: 'import { mcpOperations } from "apps/mcp"',
    description: "typeof mcpOperations",
    dependencies: { "@modelcontextprotocol/sdk": "1.30.0" },
  },
  {
    name: "stdio MCP",
    imports: 'import { stdioOperations } from "apps/mcp/stdio"',
    description: "typeof stdioOperations",
    dependencies: { "@modelcontextprotocol/sdk": "1.30.0" },
  },
]) {
  test(
    `${fixture.name} builds and runs with only its declared dependencies`,
    { timeout: 30_000 },
    async () => {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const path = yield* Path.Path;
            const directory = yield* fs.makeTempDirectoryScoped();
            const runtime = toEffectRuntime(
              nodeRuntime({ workDirectory: directory }),
              memoryBlobStore(),
            );
            const built = yield* runtime.build({
              files: files(appSource(fixture.imports, fixture.description), fixture.dependencies),
            });
            const code = yield* fs.readFileString(path.join(directory, built.build, "app.mjs"));
            assert.doesNotMatch(code, /graphql/);
            if (fixture.name !== "stdio MCP")
              assert.doesNotMatch(code, /StdioClientTransport|client\/stdio/);
            if (fixture.name === "root") assert.doesNotMatch(code, /@modelcontextprotocol/);
            const result = yield* runtime.call({
              app: "synthetic-app",
              build: built.build,
              accounts: Redacted.make({}),
              tool: "mutations.info",
              input: {},
            });
            assert.equal(result, "ok");
          }),
        ).pipe(Effect.provide(NodeServices.layer)),
      );
    },
  );
}

test("missing optional peers fail during build instead of using host dependencies", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped();
        const runtime = toEffectRuntime(
          nodeRuntime({ workDirectory: directory }),
          memoryBlobStore(),
        );
        for (const fixture of [
          { subpath: "mcp", helper: "mcpOperations", dependency: "@modelcontextprotocol/sdk" },
          {
            subpath: "mcp/stdio",
            helper: "stdioOperations",
            dependency: "@modelcontextprotocol/sdk",
          },
          { subpath: "graphql", helper: "graphqlOperations", dependency: "graphql" },
        ]) {
          const error = yield* Effect.flip(
            runtime.build({
              files: files(
                appSource(
                  `import { ${fixture.helper} } from "apps/${fixture.subpath}"`,
                  `typeof ${fixture.helper}`,
                ),
              ),
            }),
          );
          assert.equal(error._tag, "RuntimeBuildFailed");
          if (error._tag !== "RuntimeBuildFailed") throw new Error("Expected build failure");
          assert.equal(error.stage, "dependencies");
          assert.equal(error.dependency, fixture.dependency);
          assert.deepEqual(yield* fs.readDirectory(directory), []);
        }
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );
});

test(
  "a helper and app resolve the declared peer version from retained dependencies",
  { timeout: 30_000 },
  async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const directory = yield* fs.makeTempDirectoryScoped();
          const runtime = toEffectRuntime(
            nodeRuntime({ workDirectory: directory }),
            memoryBlobStore(),
          );
          const built = yield* runtime.build({
            files: files(
              appSource(
                'import { graphqlOperations } from "apps/graphql"\nimport { version } from "graphql"',
                "typeof graphqlOperations",
                "version",
              ),
              { graphql: "16.10.0" },
            ),
          });
          const code = yield* fs.readFileString(path.join(directory, built.build, "app.mjs"));
          assert.match(code, /from "graphql"/);
          assert.doesNotMatch(code, /node_modules[^\n]*graphql/);
          const result = yield* runtime.call({
            app: "synthetic-app",
            build: built.build,
            accounts: Redacted.make({}),
            tool: "mutations.info",
            input: {},
          });
          assert.equal(result, "16.10.0");
        }),
      ).pipe(Effect.provide(NodeServices.layer)),
    );
  },
);

test(
  "browser builds reject executable server imports and serve only manifest assets",
  { timeout: 30_000 },
  async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const directory = yield* fs.makeTempDirectoryScoped();
          const runtime = toEffectRuntime(
            nodeRuntime({ workDirectory: directory }),
            memoryBlobStore(),
          );
          const source = [
            { path: "index.ts", content: appSource("", '"Server-only implementation"') },
            {
              path: "ui/index.html",
              content:
                '<html><head><script type="module" src="./main.ts"></script></head><body></body></html>',
            },
            { path: "ui/main.ts", content: 'import app from "../index.ts"; console.log(app)' },
          ];
          const rejected = yield* Effect.flip(
            runtime.build({ files: Schema.decodeUnknownSync(SourceFiles)(source) }),
          );
          assert.equal(rejected._tag, "RuntimeBuildFailed");
          const built = yield* runtime.build({
            files: Schema.decodeUnknownSync(SourceFiles)(
              source.map((file) =>
                file.path === "ui/main.ts"
                  ? { ...file, content: 'document.body.textContent = "App UI"' }
                  : file,
              ),
            ),
          });
          assert.ok(built.ui?.some((asset) => asset.path.endsWith(".js")));
          const asset = runtime.asset;
          assert.ok(asset);
          assert.equal(yield* asset({ build: built.build, path: "../source/index.ts" }), undefined);
          assert.equal(yield* asset({ build: built.build, path: "index.ts" }), undefined);
          const html = yield* asset({ build: built.build, path: "index.html" });
          assert.equal(html?.contentType, "text/html");
        }),
      ).pipe(Effect.provide(NodeServices.layer)),
    );
  },
);

test("runtime operations preserve their own lookup failures", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped();
        const runtime = toEffectRuntime(
          nodeRuntime({ workDirectory: directory }),
          memoryBlobStore(),
        );
        const built = yield* runtime.build({ files: files(appSource("", '"Fixture"')) });
        const context = { build: built.build, accounts: Redacted.make({}) };
        assert.equal((yield* runtime.inspect({ ...context, app: "synthetic-app" })).length, 1);
        const missingTool = yield* runtime
          .call({ app: "synthetic-app", ...context, tool: "mutations.missing", input: {} })
          .pipe(Effect.flip);
        const missingQuery = yield* runtime
          .query({ ...context, app: "test-app", name: "missing", input: {} })
          .pipe(Effect.flip);
        assert.ok(Schema.is(HostToolNotFound)(missingTool));
        assert.ok(Schema.is(HostOperationNotFound)(missingQuery));
      }),
    ).pipe(Effect.provide(NodeServices.layer)),
  );
});
