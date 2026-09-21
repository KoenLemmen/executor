/** Retained Worker code and optional private browser asset metadata. */
import { UiAsset, type RuntimeBuildFailed, type SourceFiles } from "@executor-js/sdk/core";
import { Schema, type Effect } from "effect";

/** Executable modules are separate from browser bytes and product authentication. */
export const CloudBundle = Schema.Struct({
  mainModule: Schema.NonEmptyString,
  modules: Schema.Record(
    Schema.String,
    Schema.Union([Schema.String, Schema.Struct({ js: Schema.String })]),
  ),
});
export type CloudBundle = typeof CloudBundle.Type;

/** Private compiler RPC result; no storage handles or caller credentials cross this boundary. */
export const CompiledCloudApp = Schema.Struct({
  bundle: CloudBundle,
  ui: Schema.UndefinedOr(
    Schema.Array(
      Schema.Struct({
        path: Schema.String,
        contentType: Schema.String,
        body: Schema.Uint8Array,
      }),
    ),
  ),
});

/** A private Worker owns compiler initialization; API requests only hold its service binding. */
export type CloudCompiler = {
  readonly compile: (
    files: SourceFiles,
    headers: Readonly<Record<string, string>>,
  ) => Effect.Effect<typeof CompiledCloudApp.Type, RuntimeBuildFailed>;
};

/** The existing bundle key remains the publication point; builds without a UI omit its metadata. */
export const RetainedCloudBuild = Schema.Struct({
  ...CloudBundle.fields,
  database: Schema.Boolean,
  ui: Schema.optional(Schema.Array(UiAsset)),
});
