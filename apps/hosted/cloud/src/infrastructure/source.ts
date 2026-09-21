/** Cloud app source uses the same Git revision contract as native hosts. */
import { gitSourceStorage } from "@executor-js/app-source";
import { cloudflareRepositories } from "@executor-js/app-source/cloudflare";
import * as Cloudflare from "alchemy/Cloudflare";
import { Stage } from "alchemy/Stage";
import { Config, Effect, Option, Schema } from "effect";

/** Resolve bindings during composition; each Git operation remains scoped to its invocation. */
export const cloudAppSources = Effect.gen(function* () {
  const stage = yield* Effect.serviceOption(Stage).pipe(
    Effect.flatMap(
      Option.match({ onSome: Effect.succeed, onNone: () => Config.String("ALCHEMY_STAGE") }),
    ),
  );
  const accountId = yield* Config.String("CLOUDFLARE_ACCOUNT_ID").pipe(
    Effect.flatMap(
      Schema.decodeUnknownEffect(Schema.String.check(Schema.isPattern(/^[a-f0-9]{32}$/))),
    ),
  );
  const namespace = `executor-${stage}-apps`;
  const resource = yield* Cloudflare.Artifacts.Namespace("AppSources", { namespace });
  const binding = yield* Cloudflare.Artifacts.ReadWriteNamespace(resource);
  const repositories = cloudflareRepositories(binding, { accountId, namespace });
  return { repositories, sources: gitSourceStorage(repositories) };
}).pipe(Effect.provide(Cloudflare.Artifacts.ReadWriteNamespaceBinding), Effect.orDie);
