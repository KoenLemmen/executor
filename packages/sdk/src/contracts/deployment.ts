/** Immutable deployments, source files and expected build errors. */
import { Schema } from "effect";
import { AppCodeId, AppId, BuildId, DeploymentId, OwnerId } from "./shared.ts";

/**
 * Canonical relative POSIX path inside a deployment: no absolute paths,
 * backslashes, NUL bytes, or empty/`.`/`..` segments. Plain refined
 * strings — callers need not brand every path.
 */
export const SourceFilePath = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((path: string) => {
      if (path.includes("\0")) return "expected no NUL bytes";
      if (path.includes("\\")) return "expected POSIX separators";
      if (path.startsWith("/")) return "expected a relative path";
      return path.length > 0 && path.split("/").every((s) => s !== "" && s !== "." && s !== "..")
        ? true
        : "expected canonical segments (non-empty, no `.` or `..`)";
    }),
  ),
);

export type SourceFilePath = typeof SourceFilePath.Type;

/** One UTF-8 text file of a deployment. Content may be empty. */
export const SourceFile = Schema.Struct({ path: SourceFilePath, content: Schema.String });

export type SourceFile = typeof SourceFile.Type;

/**
 * A deployment's complete source: at least one file, unique paths, and a
 * root `index.ts` entrypoint. `package.json` is optional — the host
 * supplies `apps`, and extra dependencies may come from an
 * optional `package.json`. MCP/OpenAPI/GraphQL importers
 * emit ordinary files like these (their remote discovery still runs live at
 * evaluation); they are not special execution paths.
 */
export const SourceFiles = Schema.NonEmptyArray(SourceFile).pipe(
  Schema.check(
    Schema.makeFilter((files: ReadonlyArray<SourceFile>) =>
      new Set(files.map((f) => f.path)).size === files.length ? true : "expected unique paths",
    ),
    Schema.makeFilter((files: ReadonlyArray<SourceFile>) =>
      files.some((f) => f.path === "index.ts") ? true : "expected a root index.ts",
    ),
  ),
);

export type SourceFiles = typeof SourceFiles.Type;

/**
 * One immutable source version shared by configured apps of the same code
 * lineage. The deploying app supplies the deployment owner. `build` points at
 * retained compiled output, so activating any retained deployment —
 * including rollback — only moves the app's pointer: nothing is rebuilt
 * and no app data or external operations are reversed. The manifest is
 * NOT a build output: uploaded code is evaluated live on each use.
 */
export const Deployment = Schema.Struct({
  id: DeploymentId,
  code: AppCodeId,
  owner: OwnerId,
  files: SourceFiles,
  build: BuildId,
  createdAt: Schema.Date,
});

export type Deployment = typeof Deployment.Type;

/** Metadata for a retained deployment, without source contents. */
export const DeploymentSummary = Schema.Struct({
  id: DeploymentId,
  code: AppCodeId,
  owner: OwnerId,
  createdAt: Schema.Date,
  fileCount: Schema.Int.check(Schema.isGreaterThan(0)),
});

export type DeploymentSummary = typeof DeploymentSummary.Type;

/** No deployment with this id belongs to the configured app's code lineage. */
export class DeploymentNotFound extends Schema.TaggedError<DeploymentNotFound>()(
  "DeploymentNotFound",
  { app: AppId, deployment: DeploymentId },
  {
    httpApiStatus: 404,
    description: "No deployment matches this id and the app's code lineage.",
  },
) {}

/** The app changed since the caller read it; retry against the current pointer. */
export class AppDeploymentChanged extends Schema.TaggedError<AppDeploymentChanged>()(
  "AppDeploymentChanged",
  { app: AppId, expected: DeploymentId, current: DeploymentId },
  {
    httpApiStatus: 409,
    description:
      "The active deployment changed. Read the latest source and reconcile changes before retrying.",
  },
) {}

/** The build did not complete; nothing was retained, created or changed. */
export class DeploymentBuildFailed extends Schema.TaggedError<DeploymentBuildFailed>()(
  "DeploymentBuildFailed",
  { owner: OwnerId, name: Schema.NonEmptyString, reason: Schema.String },
  {
    httpApiStatus: 422,
    description:
      "The build failed: no deployment was retained, no new app was created, and an existing app's active deployment is unchanged. Identified by (owner, name) because a first deploy has no app id yet. `reason` is a safe summary without source or secrets.",
  },
) {}
