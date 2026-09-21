import { CurrentAuthorization } from "../contracts/authorization.ts";
import { permitsApp } from "@executor-js/authorization";
import { OrganizationForbidden } from "../contracts/organization.ts";
/** Account use cases, connection grants and OAuth routes share the same ownership checks. */
import {
  HttpUrl,
  type AccountId,
  type AppId,
  type Executor,
  type OwnerId,
} from "@executor-js/sdk/core";
import { Effect } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { HostedApi } from "../contracts/api.ts";
import { ApiAuthentication, Authentication } from "../contracts/auth.ts";
import { CurrentOrganization } from "../contracts/organization.ts";
import { HostedExecutor } from "../contracts/executor.ts";
import { adminOwner, currentOwner, ownedConnection } from "./access.ts";

/** Read provider metadata through the public SDK, including for accounts with no remaining apps. */
export const getAccount = (owner: OwnerId, account: AccountId) =>
  Effect.gen(function* () {
    const executor = yield* Effect.flatten(HostedExecutor);
    const metadata = yield* executor.accounts.get({ owner, account });
    const provider = yield* executor.accounts.provider({ owner, account });
    const policy = yield* CurrentAuthorization;
    const apps = (yield* executor.apps.list({ owner, account })).filter((app) =>
      permitsApp(policy, app.id),
    );
    if (policy.tools.kind !== "all" && apps.length === 0) return yield* new OrganizationForbidden();
    return { account: metadata, provider, apps };
  });
/** Replace credentials on the same identity so every app keeps its selection. */
export const reconnectAccount = (owner: OwnerId, account: AccountId) =>
  Effect.gen(function* () {
    const executor = yield* Effect.flatten(HostedExecutor);
    const existing = yield* executor.accounts.get({ owner, account });
    return yield* executor.accountConnections.create({
      owner,
      account,
      provider: existing.provider,
    });
  });
/** Remove saved credentials; unresolved selections stay visible instead of switching identities. */
export const disconnectAccount = (owner: OwnerId, account: AccountId) =>
  Effect.gen(function* () {
    const executor = yield* Effect.flatten(HostedExecutor);
    yield* executor.accounts.get({ owner, account });
    return yield* executor.accounts.remove({ owner, account });
  });
/** Update metadata using the owner-filtered SDK primitive. */
export const renameAccount = (owner: OwnerId, account: AccountId, label: string) =>
  Effect.gen(function* () {
    const executor = yield* Effect.flatten(HostedExecutor);
    return yield* executor.accounts.update({ owner, account, label });
  });
/** Create a sign-in request for an app requirement belonging to this organization. */
export const connectAccount = (
  owner: OwnerId,
  input: { readonly app: AppId; readonly requirement: string },
) =>
  Effect.gen(function* () {
    const executor = yield* Effect.flatten(HostedExecutor);
    yield* executor.apps.get({ owner, app: input.app });
    return yield* executor.accountConnections.create({ owner, target: input });
  });
/** Connection metadata never grants access to another organization's request or app. */
export const getConnection = (
  owner: OwnerId,
  input: Omit<Parameters<Executor["accountConnections"]["get"]>[0], "owner">,
) =>
  Effect.gen(function* () {
    const executor = yield* Effect.flatten(HostedExecutor);
    return yield* ownedConnection(executor, owner, input.connection);
  });
/** Save credentials and complete the connection's selected app requirement. */
export const submitConnection = (
  owner: OwnerId,
  input: Omit<Parameters<Executor["accountConnections"]["submit"]>[0], "owner">,
) =>
  Effect.gen(function* () {
    const executor = yield* Effect.flatten(HostedExecutor);
    yield* ownedConnection(executor, owner, input.connection);
    return yield* executor.accountConnections.submit({ ...input, owner });
  });
/** OAuth client resolution and credentials remain inside the trusted SDK. */
export const startOAuth = (
  owner: OwnerId,
  input: Omit<Parameters<Executor["accountConnections"]["startOAuth"]>[0], "owner">,
) =>
  Effect.gen(function* () {
    const executor = yield* Effect.flatten(HostedExecutor);
    yield* ownedConnection(executor, owner, input.connection);
    return yield* executor.accountConnections.startOAuth({ ...input, owner });
  });
/** Completion rechecks connection and target ownership before saving provider credentials. */
export const completeOAuth = (
  owner: OwnerId,
  input: Omit<Parameters<Executor["accountConnections"]["completeOAuth"]>[0], "owner">,
) =>
  Effect.gen(function* () {
    const executor = yield* Effect.flatten(HostedExecutor);
    yield* ownedConnection(executor, owner, input.connection);
    return yield* executor.accountConnections.completeOAuth({ ...input, owner });
  });

/** All account management uses the current admin role, including OAuth return requests. */
export const hostedAccountHandlers = HttpApiBuilder.group(HostedApi, "accounts", (handlers) =>
  Effect.gen(function* () {
    const auth = yield* Authentication;
    const api = yield* ApiAuthentication;
    const redirectUri = HttpUrl.make(
      auth.oauthRedirectUri ?? new URL("/api/oauth/callback", auth.origin).href,
    );
    return handlers
      .handle("get", ({ params }) =>
        Effect.gen(function* () {
          const owner = yield* currentOwner;
          const data = yield* getAccount(owner, params.account);
          return { ...data, canManage: (yield* CurrentOrganization).role !== "member" };
        }),
      )
      .handle("reconnect", ({ params }) =>
        Effect.flatMap(adminOwner, (owner) => reconnectAccount(owner, params.account)),
      )
      .handle("disconnect", ({ params }) =>
        Effect.flatMap(adminOwner, (owner) => disconnectAccount(owner, params.account)),
      )
      .handle("rename", ({ params, payload }) =>
        Effect.flatMap(adminOwner, (owner) => renameAccount(owner, params.account, payload.label)),
      )
      .handle("connect", ({ params, payload }) =>
        Effect.gen(function* () {
          const owner = yield* adminOwner;
          const request = yield* HttpServerRequest.HttpServerRequest;
          const headers = new Headers(request.headers);
          const organization = yield* CurrentOrganization;
          const slug = headers.has("authorization")
            ? (yield* api.authenticate(headers, organization.organization)).organizationSlug
            : yield* auth.organizationSlug(headers, organization.organization);
          const connection = yield* connectAccount(owner, { app: params.app, ...payload });
          return {
            ...connection,
            url: `${auth.origin}/org/${encodeURIComponent(slug)}/connections/${encodeURIComponent(connection.id)}`,
          };
        }),
      )
      .handle("connection", ({ params }) =>
        Effect.flatMap(adminOwner, (owner) => getConnection(owner, params)).pipe(
          Effect.map((connection) => ({ ...connection, redirectUri })),
        ),
      )
      .handle("submit", ({ params, payload }) =>
        Effect.flatMap(adminOwner, (owner) =>
          submitConnection(owner, { connection: params.connection, ...payload }),
        ),
      )
      .handle("startOAuth", ({ params, payload }) =>
        Effect.flatMap(adminOwner, (owner) =>
          startOAuth(owner, { connection: params.connection, ...payload, redirectUri }),
        ).pipe(Effect.map((signIn) => ({ ...signIn, redirectUri }))),
      )
      .handle("completeOAuth", ({ params, payload }) =>
        Effect.flatMap(adminOwner, (owner) =>
          completeOAuth(owner, { connection: params.connection, ...payload }),
        ),
      );
  }),
);

/** Keep the existing provider redirect URL. Completion still requires the browser session and membership. */
export const hostedOAuthCallback = Effect.gen(function* () {
  const { origin } = yield* Authentication;
  const request = yield* HttpServerRequest.HttpServerRequest;
  const url = new URL(request.url, "https://callback.internal");
  return HttpServerResponse.redirect(`${origin}/oauth/callback${url.search}`).pipe(
    HttpServerResponse.setHeader("cache-control", "no-store"),
    HttpServerResponse.setHeader("referrer-policy", "no-referrer"),
  );
});
