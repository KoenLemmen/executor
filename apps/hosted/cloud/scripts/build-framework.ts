/** Package the local app framework for the Worker bundler; no npm publication is required. */
import { build } from "esbuild";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Effect, FileSystem, Path } from "effect";

NodeRuntime.runMain(
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const fs = yield* FileSystem.FileSystem;
    const root = yield* path.fromFileUrl(new URL("../../../../", import.meta.url));
    for (const snapshot of [
      {
        name: "framework",
        entries: {
          index: "index",
          host: "host",
          "storage/facet": "facet",
          contracts: "contracts/host",
          mcp: "mcp",
          graphql: "graphql",
          openapi: "openapi",
          "operations/approval": "approval",
        },
        external: [],
      },
      {
        name: "browser-framework",
        entries: { index: "index", client: "client", effect: "effect", react: "react" },
        external: ["react", "react/*"],
      },
    ]) {
      const outdir = path.join(root, "apps/hosted/cloud/.generated", snapshot.name);
      const result = yield* Effect.tryPromise(() =>
        build({
          entryPoints: Object.fromEntries(
            Object.entries(snapshot.entries).map(([name, file]) => [
              name,
              path.join(root, `packages/apps/src/${file}.ts`),
            ]),
          ),
          outdir,
          bundle: true,
          splitting: true,
          format: "esm",
          platform: "browser",
          target: "es2022",
          minify: true,
          write: false,
          external: snapshot.external,
        }),
      );
      const files = Object.fromEntries(
        result.outputFiles.map((file) => [
          `node_modules/apps/${path.relative(outdir, file.path)}`,
          file.text,
        ]),
      );
      files["node_modules/apps/package.json"] = JSON.stringify({
        name: "apps",
        type: "module",
        exports: Object.fromEntries(
          Object.keys(snapshot.entries).map((name) => [
            name === "index" ? "." : `./${name}`,
            `./${name}.js`,
          ]),
        ),
      });
      yield* fs.makeDirectory(path.dirname(outdir), { recursive: true });
      yield* fs.writeFileString(
        path.join(path.dirname(outdir), `${snapshot.name}.json`),
        JSON.stringify(files),
      );
    }
    const authoring = yield* fs.readFileString(
      path.join(root, "packages/app-templates/executor/skills/app-authoring/SKILL.md"),
    );
    yield* fs.writeFileString(
      path.join(root, "apps/hosted/cloud/.generated/executor-authoring.json"),
      JSON.stringify(authoring),
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);
