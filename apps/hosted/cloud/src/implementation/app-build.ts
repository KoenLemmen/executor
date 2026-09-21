/** Compile server and browser source inside workerd using Cloudflare's dependency resolver. */
import { createApp, InMemoryFileSystem } from "@cloudflare/worker-bundler";
import { RuntimeBuildFailed, type SourceFiles } from "@executor-js/sdk/core";
import { prepareUiBuild } from "@executor-js/sdk/ui-build";
import { Effect, Path, Schema } from "effect";
import type { Plugin } from "esbuild";
import { CloudBundle } from "../contracts/builds.ts";
import { appBridge } from "./app-bridge.ts";
import { wasmBuild } from "./wasm-build.ts";
import { browserBuild } from "./browser-build.ts";
import framework from "../../.generated/framework.json" with { type: "json" };

const frameworkExports = [
  "apps",
  "apps/host",
  "apps/storage/facet",
  "apps/contracts",
  "apps/mcp",
  "apps/graphql",
  "apps/openapi",
  "apps/operations/approval",
];
const frameworkModules = {
  ...Object.fromEntries(Object.entries(framework).filter(([name]) => name.endsWith(".js"))),
  ...Object.fromEntries(
    frameworkExports.map((name) => [
      name,
      {
        js: `export * from "${name === "apps" ? "./" : "../".repeat(name.split("/").length - 1)}node_modules/apps/${name === "apps" ? "index" : name.slice(5)}.js";`,
      },
    ]),
  ),
};
const quietCompiler: Plugin = {
  name: "private-build-diagnostics",
  setup(build) {
    build.initialOptions.logLevel = "silent";
  },
};

/** Compilation returns browser bytes separately; neither imports nor credentials cross from server execution. */
export const compileCloudApp = (files: SourceFiles) =>
  Effect.gen(function* () {
    if (files.some((file) => file.path.split("/").includes("node_modules")))
      return yield* new RuntimeBuildFailed({ stage: "source" });
    const filesystem = new InMemoryFileSystem({
      ...Object.fromEntries(files.map((file) => [file.path, file.content])),
      "__executor_worker.ts": appBridge,
    });
    const plan = yield* prepareUiBuild(files);
    const browser = plan === undefined ? undefined : yield* browserBuild(files, filesystem, plan);
    const wasm = wasmBuild(filesystem, yield* Path.Path);
    const compiled = yield* Effect.tryPromise({
      try: () =>
        createApp({
          files: filesystem,
          server: "__executor_worker.ts",
          externals: frameworkExports,
          minify: true,
          jsx: "automatic",
          define: { "process.env.NODE_ENV": '"production"' },
          ...(plan === undefined ? {} : { client: [...plan.entries] }),
          __dangerouslyUseEsBuildPluginsDoNotUseOrYouWillBeFired: [
            quietCompiler,
            wasm.plugin,
            ...(browser === undefined ? [] : [browser.plugin]),
          ],
        }),
      catch: () => new RuntimeBuildFailed({ stage: "compile" }),
    });
    const bundle = yield* Schema.decodeUnknownEffect(Schema.toType(CloudBundle))({
      ...compiled,
      modules: { ...compiled.modules, ...frameworkModules, ...wasm.modules },
    }).pipe(Effect.mapError(() => new RuntimeBuildFailed({ stage: "compile" })));
    const ui = browser === undefined ? undefined : yield* browser.finish();
    return { bundle, ui };
  }).pipe(Effect.provide(Path.layer), Effect.withSpan("runtime.cloud.compile"));
