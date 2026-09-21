import { executorSelfHostApiDocument } from "./contracts/api.ts";
/** Self-host SDK uses the same PGlite connection as Better Auth. */
import { urlPolicyConfig } from "@executor-js/utils/url-policy";
import { toEffectRuntime, makeExecutorStorage, type SourceFile } from "@executor-js/sdk/core";
import {
  HostedExecutor,
  OrganizationIcons,
  makeOrganizationIcons,
  OrganizationDefaults,
  organizationDefaults,
} from "@executor-js/hosted-server";
import { postgresExecutor } from "@executor-js/hosted-server/database";
import { HostedAppRuntime } from "@executor-js/hosted-server/app-ui/contracts";
import { nodeRuntime, filesystemBlobStore, filesystemAppDatabases } from "@executor-js/sdk/node";
import { Config, Effect, Layer, Option, Path } from "effect";
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
      const runtime = nodeRuntime({ workDirectory: path.resolve(directory, "runtime-cache") });
      const blobs = filesystemBlobStore({ directory: path.resolve(directory, "builds") });
      const storage = yield* makeExecutorStorage({ provider: "postgresql" });
      const appStorage = yield* filesystemAppDatabases({
        directory: path.resolve(directory, "app-data"),
        reactivity: storage.reactivity,
        crypto,
      });
      const executor = yield* postgresExecutor(
        key,
        runtime,
        blobs,
        { urlPolicy, ...(clientMetadataUrl === undefined ? {} : { clientMetadataUrl }) },
        { storage, appStorage, webhookOrigin: origin },
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
