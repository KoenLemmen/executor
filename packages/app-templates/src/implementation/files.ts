/** Generated source boundaries and retained dependency manifests. */
import { Effect, Schema } from "effect";
import { SourceFiles } from "@executor-js/sdk";
import { TemplateError } from "../contracts/templates.ts";

/** Parse generated file paths and content before handing them to a host deployment API. */
export const sourceFiles = (
  files: readonly { readonly path: string; readonly content: string }[],
) =>
  Schema.decodeUnknownEffect(SourceFiles)(files).pipe(
    Effect.mapError(() => new TemplateError({ reason: "The app source could not be generated." })),
  );

/** Retained dependency manifest. Host-provided apps and Effect are not installed twice. */
export const dependencyFile = (dependencies: Readonly<Record<string, string>>) => ({
  path: "package.json",
  content: JSON.stringify({ private: true, type: "module", dependencies }, null, 2),
});
