/** Compose native operations once for in-process and HTTP callers. */
import { Crypto, Effect } from "effect";
import type { Executor, ExecutorOptions, RemoteExecutorOptions } from "../contracts/executor.ts";
import { NotImplemented } from "../contracts/shared.ts";
import { makeWebhooks } from "./webhooks.ts";
import { makeAppData } from "./app-storage.ts";
import { makeAccountConnections } from "./account-connections.ts";
import { makeAccounts } from "./accounts.ts";
import { makeApps } from "./apps.ts";
import { makeOwners } from "./owners.ts";
import { makeTools } from "./tools.ts";
import { makeSkills } from "./skills.ts";
import { toEffectRuntime } from "./runtime.ts";
import { database } from "./database.ts";
import { makeOAuth } from "./oauth.ts";

/** Capture host cryptography; caller owns database and platform resource lifetimes. */
export const createExecutor = (
  options: ExecutorOptions,
): Effect.Effect<Executor, never, Crypto.Crypto> =>
  Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto;
    const db = database(options.storage);
    const runtime = toEffectRuntime(options.runtime, options.blobs);
    const oauth = makeOAuth(db, options.credentials, crypto, options.oauth);
    const webhooks = makeWebhooks(
      options.storage,
      runtime,
      oauth.resolve,
      options.credentials,
      crypto,
      options.webhookOrigin,
      options.appStorage,
    );
    const apps = makeApps(db, runtime, crypto);
    return {
      accounts: makeAccounts(db, options.credentials, crypto),
      accountConnections: {
        ...makeAccountConnections(db, options.credentials, crypto),
        ...oauth.connections,
      },
      apps,
      owners: makeOwners(db),
      skills: makeSkills(apps),
      ...webhooks,
      appData: makeAppData(options.storage, oauth.resolve, runtime, options.appStorage),
      tools: makeTools(
        options.storage,
        oauth.resolve,
        runtime,
        options.credentials,
        crypto,
        options.appStorage,
      ),
    };
  });

/** Remote transport is not implemented yet; it will expose the same native contract. */
export const createRemoteExecutor = (
  _options: RemoteExecutorOptions,
): Effect.Effect<Executor, NotImplemented> =>
  Effect.fail(new NotImplemented({ operation: "createRemoteExecutor" }));
