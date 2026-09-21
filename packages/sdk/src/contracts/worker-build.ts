/** Retained Worker code and optional private browser asset metadata. */
import { UiAsset } from "./runtime.ts";
import { Schema } from "effect";

export { WorkerBundle } from "@executor-js/app-data/worker-bundle";
import { WorkerBundle } from "@executor-js/app-data/worker-bundle";
export type WorkerBundle = typeof WorkerBundle.Type;

/** The existing bundle key remains the publication point; builds without a UI omit its metadata. */
export const RetainedWorkerBuild = Schema.Struct({
  ...WorkerBundle.fields,
  database: Schema.Boolean,
  ui: Schema.optional(Schema.Array(UiAsset)),
});
