/** One transactional purge for an owner that no longer exists. */
import { Effect } from "effect";
import type { Executor } from "../contracts/executor.ts";
import { OwnerWebhooksActive } from "../contracts/owner.ts";
import { WebhookId } from "../contracts/shared.ts";
import { query, transaction, type Query } from "./database.ts";

/** Owner-keyed rows and the app/account-keyed rows that hang off them, deleted in dependency order. */
export const makeOwners = (db: Query): Executor["owners"] => ({
  remove: (input: Parameters<Executor["owners"]["remove"]>[0]) =>
    transaction(db, (tx) =>
      Effect.gen(function* () {
        const owner = input.owner;
        const apps = yield* query(() =>
          tx.findMany("apps", { select: ["id"], where: (b) => b("owner", "=", owner) }),
        );
        const accounts = yield* query(() =>
          tx.findMany("accounts", { select: ["id"], where: (b) => b("owner", "=", owner) }),
        );
        const webhooks = yield* query(() =>
          tx.findMany("webhooks", {
            select: ["id", "status"],
            where: (b) => b("owner", "=", owner),
          }),
        );
        // A registration still held at the provider is the caller's to remove; never abandon it.
        const live = webhooks.filter((webhook) => webhook.status !== "stopped");
        if (live.length > 0)
          return yield* new OwnerWebhooksActive({
            owner,
            subscriptions: live.map((webhook) => WebhookId.make(webhook.id)),
          });
        const appIds = apps.map((app) => app.id);
        const accountIds = accounts.map((account) => account.id);
        const webhookIds = webhooks.map((webhook) => webhook.id);
        if (webhookIds.length > 0) {
          yield* query(() =>
            tx.deleteMany("webhookAccounts", {
              where: (b) => b("subscription", "in", webhookIds),
            }),
          );
          yield* query(() => tx.deleteMany("webhooks", { where: (b) => b("owner", "=", owner) }));
        }
        if (appIds.length > 0) {
          yield* query(() => tx.deleteMany("appRecords", { where: (b) => b("app", "in", appIds) }));
          yield* query(() => tx.deleteMany("apps", { where: (b) => b("owner", "=", owner) }));
        }
        if (accountIds.length > 0) {
          yield* query(() =>
            tx.deleteMany("oauthGrants", { where: (b) => b("id", "in", accountIds) }),
          );
          yield* query(() => tx.deleteMany("accounts", { where: (b) => b("owner", "=", owner) }));
        }
        const connections = yield* query(() =>
          tx.findMany("accountConnections", {
            select: ["id", "oauthAttempt"],
            where: (b) => b("owner", "=", owner),
          }),
        );
        const attempts = connections
          .map((connection) => connection.oauthAttempt)
          .filter((attempt): attempt is string => attempt !== null);
        if (attempts.length > 0)
          yield* query(() =>
            tx.deleteMany("oauthAttempts", { where: (b) => b("id", "in", attempts) }),
          );
        if (connections.length > 0)
          yield* query(() =>
            tx.deleteMany("accountConnections", { where: (b) => b("owner", "=", owner) }),
          );
        yield* query(() =>
          tx.deleteMany("toolApprovals", { where: (b) => b("owner", "=", owner) }),
        );
        // Apps reference their active deployment, so retained code is removed last.
        const deployments = yield* query(() =>
          tx.findMany("deployments", { select: ["id"], where: (b) => b("owner", "=", owner) }),
        );
        if (deployments.length > 0)
          yield* query(() =>
            tx.deleteMany("deployments", { where: (b) => b("owner", "=", owner) }),
          );
        return {
          owner,
          apps: appIds.length,
          accounts: accountIds.length,
          deployments: deployments.length,
          connections: connections.length,
        };
      }),
    ).pipe(Effect.withSpan("sdk.owners.remove")),
});
