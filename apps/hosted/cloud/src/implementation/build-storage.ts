/** Publish immutable browser objects before the existing retained Worker bundle key. */
import {
  BlobKey,
  BlobStore,
  RuntimeBuildFailed,
  RuntimeBuildUnavailable,
  type BuildId,
} from "@executor-js/sdk/core";
import type { UiBuildFile } from "@executor-js/sdk/ui-build";
import { Effect, Option, Schema } from "effect";
import { RetainedCloudBuild, type CloudBundle } from "../contracts/builds.ts";

const key = (value: string) => Schema.decodeUnknownEffect(BlobKey)(value);

/** A successful return makes both server code and every listed UI object available. Failed publication yields no build reference. */
export const retainCloudBuild = (
  build: BuildId,
  bundle: CloudBundle & Pick<typeof RetainedCloudBuild.Type, "database">,
  ui: readonly UiBuildFile[] | undefined,
) =>
  Effect.gen(function* () {
    const blobs = yield* BlobStore;
    if (ui !== undefined)
      yield* Effect.forEach(
        ui,
        (file) =>
          Effect.gen(function* () {
            yield* blobs.put(yield* key(`${build}/ui/${file.path}`), file.body);
          }),
        { concurrency: 8, discard: true },
      );
    const metadata = ui?.map(({ path, contentType }) => ({ path, contentType }));
    yield* blobs.put(
      yield* key(`${build}.json`),
      new TextEncoder().encode(
        JSON.stringify({ ...bundle, ...(metadata === undefined ? {} : { ui: metadata }) }),
      ),
    );
    return metadata;
  }).pipe(
    Effect.mapError(() => new RuntimeBuildFailed({ stage: "retain" })),
    Effect.withSpan("runtime.cloud.retain"),
  );

/** Previous Worker-only bundles remain valid: UI metadata is optional. */
export const loadCloudBuild = (build: BuildId) =>
  Effect.gen(function* () {
    const blobs = yield* BlobStore;
    const found = yield* blobs.get(yield* key(`${build}.json`));
    if (Option.isNone(found)) return yield* new RuntimeBuildUnavailable();
    return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(RetainedCloudBuild))(
      new TextDecoder().decode(found.value),
    );
  }).pipe(Effect.mapError(() => new RuntimeBuildUnavailable()));

/** The product authenticates access; this capability serves only assets listed in the immutable build. */
export const cloudBuildAsset = (build: BuildId, path: string) =>
  Effect.gen(function* () {
    const retained = yield* loadCloudBuild(build);
    const asset = retained.ui?.find((asset) => asset.path === path);
    if (asset === undefined) return undefined;
    const blobs = yield* BlobStore;
    const found = yield* blobs.get(yield* key(`${build}/ui/${asset.path}`));
    if (Option.isNone(found)) return yield* new RuntimeBuildUnavailable();
    return { body: found.value, contentType: asset.contentType };
  }).pipe(
    Effect.mapError(() => new RuntimeBuildUnavailable()),
    Effect.withSpan("runtime.cloud.asset"),
  );
