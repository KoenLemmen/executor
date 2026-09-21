import { executorSelfHostApiDocument } from "./contracts/api.ts";
/** Self-host SDK uses the same PGlite connection as Better Auth. */
import { urlPolicyConfig } from "@executor-js/utils/url-policy";
import {
  toEffectRuntime,
  makeExecutorStorage,
  WorkflowHost,
  type Executor,
  type SourceFile,
} from "@executor-js/sdk/core";
import {
  HostedExecutor,
  OrganizationIcons,
  makeOrganizationIcons,
  OrganizationDefaults,
  organizationDefaults,
} from "@executor-js/hosted-server";
import { postgresExecutor } from "@executor-js/hosted-server/database";
import { HostedAppRuntime } from "@executor-js/hosted-server/app-ui/contracts";
import { filesystemBlobStore, workerdApps } from "@executor-js/sdk/node";
import { Config, Effect, Layer, Option, Path, Deferred, Schedule } from "effect";
import { dataDirectory } from "./contracts/config.ts";

/** Database initialization finishes before this service is acquired. */
export const selfHostExecutor = (skills: readonly SourceFile[]) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const directory = yield* dataDirectory;
      const key = yield* Config.Redacted("EXECUTOR_ENCRYPTION_KEY");
      const origin = yield* Config.String("BETTER_AUTH_URL");
      const urlPolicy = yield* urlPolicyConfig;
      const clientMetadataUrl = yield* Config.String("EXECUTOR_OAUTH_CLIENT_METADATA_URL").pipe(
        Config.option,
        Config.map(Option.getOrUndefined),
      );
      const blobs = filesystemBlobStore({ directory: path.resolve(directory, "builds") });
      const storage = yield* makeExecutorStorage({ provider: "postgresql" });
      const ready = yield* Deferred.make<Executor>();
      const { runtime, workflows } = yield* workerdApps({
        directory: path.resolve(directory, "workerd"),
        blobs,
        executor: Deferred.await(ready),
        legacyDataDirectories: [
          path.resolve(directory, "app-data"),
          path.resolve(directory, "workflow-engine"),
        ],
      });
      const executor = yield* postgresExecutor(
        key,
        runtime,
        blobs,
        { urlPolicy, ...(clientMetadataUrl === undefined ? {} : { clientMetadataUrl }) },
        { storage, webhookOrigin: origin, workflows },
      );
      yield* Deferred.succeed(ready, executor);
      yield* Effect.forkScoped(
        executor[WorkflowHost].reconcile.pipe(
          Effect.catch(() => Effect.logWarning("Workflow queue reconciliation failed")),
          Effect.repeat(Schedule.spaced("5 seconds")),
        ),
      );
      const initialize = yield* organizationDefaults(
        executor,
        origin,
        storage,
        skills,
        executorSelfHostApiDocument(origin),
      );
      return Layer.mergeAll(
        Layer.succeed(OrganizationIcons, makeOrganizationIcons(blobs)),
        Layer.succeed(HostedExecutor, Effect.succeed(executor)),
        Layer.succeed(OrganizationDefaults, initialize),
        Layer.succeed(HostedAppRuntime, toEffectRuntime(runtime, blobs)),
      );
    }),
  );
