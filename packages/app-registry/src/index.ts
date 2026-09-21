/** Publish a chosen Git snapshot; installation creates an ordinary, independently owned app. */
import { Clock, Effect, Schema } from "effect";
import {
  SourceFiles,
  type AppCopySnapshot,
  type AppId,
  type OwnerId,
  type AppSourceStorage,
  type Executor,
} from "@executor-js/sdk/core";
import {
  PackageManifest,
  Publication,
  PublicationSnapshot,
  RegistryError,
  type Registry,
  type PublicationReference,
} from "./contracts/registry.ts";
import type { RegistryStorage } from "./implementation/storage.ts";
export * from "./contracts/registry.ts";
export { makeRegistryStorage } from "./implementation/storage.ts";

/** Public snapshots must be self-contained app source; normal npm dependencies stay untouched. */
const publicationSource = (files: SourceFiles) =>
  Effect.gen(function* () {
    if (
      files.length > 512 ||
      files.reduce((size, file) => size + new TextEncoder().encode(file.content).length, 0) >
        4 * 1024 * 1024
    )
      return yield* new RegistryError({ reason: "limit" });
    if (
      files.some(
        (file) =>
          /(^|\/)(?:\.git|node_modules|\.env(?:\..*)?|\.npmrc|\.executor)(?:\/|$)/.test(
            file.path,
          ) ||
          file.path === "executor.lock.json" ||
          file.path.startsWith("__executor_deps/"),
      )
    )
      return yield* new RegistryError({ reason: "invalid-source" });
    const manifest = files.find((file) => file.path === "package.json");
    if (manifest === undefined) return yield* new RegistryError({ reason: "invalid-manifest" });
    const parsed = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(PackageManifest))(
      manifest.content,
    ).pipe(Effect.mapError(() => new RegistryError({ reason: "invalid-manifest" })));
    if (Object.keys(parsed.executor?.dependencies ?? {}).length > 0)
      return yield* new RegistryError({ reason: "unsupported-dependencies" });
    return parsed;
  });
/** A catalog entry reads its pinned Git snapshot, independent of the editable default branch. */
export const storedRegistry = (
  storage: RegistryStorage,
  sources: AppSourceStorage,
  origin: string,
): Registry => ({
  origin,
  list: storage.list,
  snapshot: (name, commit) =>
    Effect.gen(function* () {
      const row = yield* storage.get(name);
      if (row.publication.commit !== commit) return yield* new RegistryError({ reason: "changed" });
      const files = yield* sources
        .read(row.source)
        .pipe(Effect.mapError(() => new RegistryError({ reason: "storage" })));
      return PublicationSnapshot.make({ publication: row.publication, files });
    }),
});
/** Publication retains source before exposing its catalog pointer; it does not deploy the app. */
export const createAppRegistry = (options: {
  readonly storage: RegistryStorage;
  readonly executor: Executor;
  readonly sources: AppSourceStorage;
}) => {
  const { storage, executor, sources } = options;
  return {
    owned: storage.owned,
    unpublish: storage.unpublish,
    publish: (input: {
      readonly owner: OwnerId;
      readonly namespace: string;
      readonly app: AppId;
      readonly commit: string;
    }) =>
      Effect.gen(function* () {
        const app = yield* executor.apps
          .get({ owner: input.owner, app: input.app })
          .pipe(Effect.mapError(() => new RegistryError({ reason: "forbidden" })));
        const files = yield* sources
          .read({ code: app.code, commit: input.commit })
          .pipe(Effect.mapError(() => new RegistryError({ reason: "invalid-source" })));
        const manifest = yield* publicationSource(files);
        const scope = manifest.name.slice(1, manifest.name.indexOf("/"));
        const owner = yield* storage.scopeOwner(scope);
        if (owner === null ? scope !== input.namespace : owner !== input.owner)
          return yield* new RegistryError({ reason: "forbidden" });
        const source = yield* sources
          .retain(app.code, files)
          .pipe(Effect.mapError(() => new RegistryError({ reason: "storage" })));
        return yield* storage.publish({
          name: manifest.name,
          owner: input.owner,
          app: app.id,
          source,
          publication: Publication.make({
            name: manifest.name,
            commit: input.commit,
            description: manifest.description ?? "",
            publishedAt: new Date(yield* Clock.currentTimeMillis).toISOString(),
          }),
        });
      }),
  };
};
/** Resolve reviewed public source for the shared SDK copy operation. No app is created here. */
export const resolvePublication = (
  registry: Registry,
  input: typeof PublicationReference.Type,
): Effect.Effect<AppCopySnapshot, RegistryError> =>
  Effect.gen(function* () {
    const snapshot = yield* registry.snapshot(input.package, input.commit);
    if (snapshot.publication.name !== input.package || snapshot.publication.commit !== input.commit)
      return yield* new RegistryError({ reason: "changed" });
    const manifest = yield* publicationSource(snapshot.files);
    if (manifest.name !== input.package)
      return yield* new RegistryError({ reason: "invalid-source" });
    return {
      files: snapshot.files,
      origin: {
        reference: new URL(
          `/api/registry/source?name=${encodeURIComponent(input.package)}&commit=${encodeURIComponent(input.commit)}`,
          registry.origin,
        ).href,
        name: input.package,
        commit: input.commit,
      },
      activation: "deploy",
    };
  });
export { remoteRegistry } from "./client.ts";
