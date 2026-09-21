/** Explicit one-time conversion of the old Node build directories. Never run during server startup. */
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, Path, Schema } from "effect";
import { BlobStore, type BlobStorage } from "./contracts/blobs.ts";
import { BuiltApp, RuntimeBuildFailed } from "./contracts/runtime.ts";
import { retainNodeBuild } from "./implementation/node-builds.ts";

/**
 * Copy retained builds to a supplied blob store while preserving build IDs, UI paths and dependency bytes.
 * SQL records and original directories are unchanged. Completed copies remain valid if a later copy fails;
 * rerunning is safe. Hosts must approve conversion before applying this to existing data.
 */
export const migrateNodeBuilds = (options: {
  readonly directory: string;
  readonly blobs: BlobStorage;
}) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const names = yield* fs.readDirectory(options.directory);
      const migrated: BuiltApp["build"][] = [];
      for (const name of names.filter((name) => /^bld_[a-f0-9-]{36}$/.test(name)).sort()) {
        const directory = path.join(options.directory, name);
        const manifest = yield* fs
          .readFileString(path.join(directory, "build.json"))
          .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(BuiltApp))));
        if (manifest.build !== name) return yield* new RuntimeBuildFailed({ stage: "retain" });
        yield* retainNodeBuild(directory, manifest);
        migrated.push(manifest.build);
      }
      return migrated;
    }).pipe(Effect.provideService(BlobStore, options.blobs), Effect.provide(NodeServices.layer)),
  );
