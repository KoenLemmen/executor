/** Public app listings identify a chosen Git revision, without package versions or dependency resolution. */
import { Schema, type Effect } from "effect";
import { SourceCommit, SourceFiles } from "@executor-js/sdk/core";

/** Public name inside a publishing owner's namespace. */
export const PackageName = Schema.String.check(
  Schema.isPattern(/^@[a-z0-9][a-z0-9-]{0,79}\/[a-z0-9][a-z0-9-]{0,62}$/),
);
/** Standard npm metadata remains source; only name and description identify a public listing. */
export const PackageManifest = Schema.Struct({
  name: PackageName,
  description: Schema.optional(Schema.String.check(Schema.isMaxLength(2000))),
  executor: Schema.optional(
    Schema.Struct({
      dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    }),
  ),
});
/** One current public listing. The commit is the author's selected Git revision. */
export const Publication = Schema.Struct({
  name: PackageName,
  commit: SourceCommit,
  description: Schema.String,
  publishedAt: Schema.String,
});
/** A complete source copy, with no private Git history, credentials, or app data. */
export const PublicationSnapshot = Schema.Struct({ publication: Publication, files: SourceFiles });
/** Public copies identify the exact revision the user reviewed. */
export const PublicationReference = Schema.Struct({
  package: PackageName,
  commit: SourceCommit,
});
/** Safe public-catalog failures. */
export class RegistryError extends Schema.TaggedError<RegistryError>()(
  "RegistryError",
  {
    reason: Schema.Literals([
      "not-found",
      "forbidden",
      "conflict",
      "changed",
      "invalid-source",
      "invalid-manifest",
      "unsupported-dependencies",
      "storage",
      "registry",
      "limit",
    ]),
  },
  { httpApiStatus: 400 },
) {}
/** Public reads require a selected commit; a changed listing never silently selects newer code. */
export interface Registry {
  readonly origin: string;
  readonly list: (
    name?: string,
  ) => Effect.Effect<ReadonlyArray<typeof Publication.Type>, RegistryError>;
  readonly snapshot: (
    name: string,
    commit: string,
  ) => Effect.Effect<typeof PublicationSnapshot.Type, RegistryError>;
}

/** A public listing has one stable URL even when its selected commit changes. */
export const registryPublicationPath = (name: string): string =>
  `/apps/${name.slice(1).split("/").map(encodeURIComponent).join("/")}`;
