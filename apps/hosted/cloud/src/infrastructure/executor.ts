import { executorCloudApiDocument } from "../contracts/api.ts";
/** Cloud composition: Postgres is authoritative; no organization data is stored in a DO. */
import { urlPolicyConfig } from "@executor-js/utils/url-policy";
import { executorSkillFiles } from "@executor-js/app-templates/executor";
import authoring from "../../.generated/executor-authoring.json" with { type: "json" };
import * as BrowserCrypto from "@effect/platform-browser/BrowserCrypto";
import { PgClient } from "@effect/sql-pg";
import {
  HostedExecutor,
  OrganizationIcons,
  makeOrganizationIcons,
  OrganizationDefaults,
  organizationDefaults,
} from "@executor-js/hosted-server";
import { postgresExecutor } from "@executor-js/hosted-server/database";
import { HostedAppRuntime } from "@executor-js/hosted-server/app-ui";
import { StorageError, BlobStore, makeExecutorStorage } from "@executor-js/sdk/core";
import { makeExecutionMemo } from "alchemy/Runtime/ExecutionMemo";
import { RuntimeContext } from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { Config, Effect, Layer, Option } from "effect";
import { cloudBuildAsset } from "../implementation/build-storage.ts";
import { withExecutorAnalytics } from "../implementation/product-analytics.ts";
import { cloudBlobs } from "./blobs.ts";
import { cloudWorkflows } from "./workflows.ts";
import { cloudRuntime } from "./runtime.ts";
import { DatabaseConnection } from "./database.ts";
import { cloudSecrets } from "./secrets.ts";
import { cloudOrigin } from "./stage.ts";
import type { AppDataSupervisor } from "./app-data.ts";

/**
 * Alchemy owns one concrete Effect SQL client per invocation, closed with that invocation.
 * Its SQL.PostgresLayer currently returns a lazy proxy: FumaDB's synchronous Statement.join
 * cannot inspect those deferred fragments. Resolve the native client before composing ORM
 * queries, using Alchemy's execution memo rather than an isolate-global pool.
 */
export const cloudExecutor = Effect.fn(function* (
  databases: Cloudflare.DurableObject<AppDataSupervisor>,
) {
  // Resolve during initialization so Alchemy binds every value into the Worker environment.
  const secrets = yield* cloudSecrets.pipe(Effect.orDie);
  const origin = yield* cloudOrigin.pipe(Effect.orDie);
  const urlPolicy = yield* urlPolicyConfig;
  const clientMetadataUrl = yield* Config.String("EXECUTOR_OAUTH_CLIENT_METADATA_URL").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  );
  const connection = yield* Cloudflare.Hyperdrive.Connect(yield* DatabaseConnection);
  const makeRuntime = yield* cloudRuntime(databases);
  const workflows = yield* cloudWorkflows;
  const blobs = yield* cloudBlobs;
  const executor = yield* makeExecutionMemo(
    Effect.gen(function* () {
      const url = yield* connection.connectionString;
      const key = yield* secrets.encryptionKey;
      const services = yield* Layer.build(
        PgClient.layer({ url, maxConnections: 1, prepare: false }),
      );
      const runtime = yield* makeRuntime;
      const storage = yield* makeExecutorStorage({ provider: "postgresql" }).pipe(
        Effect.provideContext(services),
      );
      const executor = yield* postgresExecutor(
        key,
        runtime,
        blobs,
        { urlPolicy, ...(clientMetadataUrl === undefined ? {} : { clientMetadataUrl }) },
        { storage, webhookOrigin: origin, workflows },
      ).pipe(Effect.provideContext(services), Effect.provide(BrowserCrypto.layer));
      const initialize = yield* organizationDefaults(
        executor,
        origin,
        storage,
        executorSkillFiles(authoring),
        executorCloudApiDocument(origin),
      ).pipe(Effect.provideContext(services));
      return { executor, initialize };
    }).pipe(Effect.mapError(() => new StorageError())),
  );
  // Alchemy's runtime requirement marks event-only operations; it is not a
  // service supplied to request fibers. Keep the live caller scope and tracer.
  return Layer.mergeAll(
    Layer.succeed(OrganizationIcons, makeOrganizationIcons(blobs)),
    Layer.succeed(HostedAppRuntime, {
      asset: ({ build, path }) =>
        cloudBuildAsset(build, path).pipe(Effect.provideService(BlobStore, blobs)),
    }),
    Layer.succeed(
      HostedExecutor,
      executor.pipe(
        Effect.map((resources) => withExecutorAnalytics(resources.executor)),
        Effect.provide(RuntimeContext.phantom),
      ),
    ),
    Layer.succeed(
      OrganizationDefaults,
      OrganizationDefaults.of((organization, user) =>
        executor.pipe(
          Effect.flatMap((resources) => resources.initialize(organization, user)),
          Effect.provide(RuntimeContext.phantom),
        ),
      ),
    ),
  );
}, Effect.provide(Cloudflare.Hyperdrive.ConnectBinding));
