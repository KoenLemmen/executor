import { resolveOrganizationReference } from "./organization-reference.ts";
import { apiKeyUser, userApiKeyPrefix } from "./user-api-key.ts";
import { GrantId, mcpOAuthResources } from "@executor-js/mcp-auth";
/** Hosted membership composes with the shared OAuth grant lifecycle. */
import type { BetterAuthPlugin, GenericEndpointContext } from "@better-auth/core";
import { APIError, createAuthEndpoint, isAPIError } from "better-auth/api";
import { Effect, Redacted, Schema } from "effect";
import {
  grantOAuthPlugins,
  authCall,
  runAuth,
  type GrantAccess,
} from "@executor-js/mcp-auth/oauth";
import { AuthenticationUnavailable, Unauthorized } from "../contracts/auth.ts";
import { McpAccess, McpForbidden, McpUnauthorized } from "../contracts/mcp.ts";
import {
  OrganizationForbidden,
  OrganizationId,
  OrganizationRole,
  OrganizationReference,
  organizationOwner,
} from "../contracts/organization.ts";
const resolveReference = (
  context: GenericEndpointContext["context"],
  reference: typeof OrganizationReference.Type,
) =>
  resolveOrganizationReference(context.adapter, reference).pipe(
    Effect.catchTags({
      OrganizationForbidden: () => Effect.fail(new APIError("FORBIDDEN")),
      AuthenticationUnavailable: () => Effect.fail(new APIError("SERVICE_UNAVAILABLE")),
    }),
  );
const Member = Schema.Struct({ role: OrganizationRole });
const membership = (
  context: GenericEndpointContext["context"],
  userId: string,
  organization: OrganizationId,
) =>
  authCall(() =>
    context.adapter.findOne({
      model: "member",
      where: [
        { field: "userId", value: userId },
        { field: "organizationId", value: organization },
      ],
    }),
  ).pipe(
    Effect.flatMap((member) =>
      Schema.decodeUnknownEffect(Member)(member).pipe(
        Effect.mapError(
          () =>
            new APIError("FORBIDDEN", {
              message: "You no longer have access to this organization.",
            }),
        ),
      ),
    ),
  );

/** A consent binds a new grant to the selected organization; refresh retains its identity. */
export const mcpOAuthPlugins = (origin: string) => {
  const oauth = grantOAuthPlugins({
    origin,
    scopes: ["mcp", "executor", "offline_access"],
    resources: [
      ...mcpOAuthResources(origin),
      { identifier: `${origin}/api`, allowedScopes: ["executor", "offline_access"] },
    ],
    selectResource: (ctx, userId) =>
      Effect.gen(function* () {
        const organization = yield* Schema.decodeUnknownEffect(OrganizationId)(
          ctx.headers?.get("x-executor-organization"),
        ).pipe(Effect.mapError(() => new APIError("BAD_REQUEST")));
        yield* membership(ctx.context, userId, organization);
        return organization;
      }),
    checkResource: (ctx, userId, resource) =>
      Schema.decodeUnknownEffect(OrganizationId)(resource).pipe(
        Effect.mapError(() => new APIError("FORBIDDEN")),
        Effect.flatMap((organization) => membership(ctx.context, userId, organization)),
        Effect.asVoid,
      ),
  });
  const projectAccess = (ctx: GenericEndpointContext, grant: GrantAccess) =>
    Effect.gen(function* () {
      const organization = yield* Schema.decodeUnknownEffect(OrganizationId)(grant.resource).pipe(
        Effect.mapError(() => new APIError("FORBIDDEN")),
      );
      const member = yield* membership(ctx.context, grant.userId, organization);
      return McpAccess.make({
        userId: grant.userId,
        clientId: grant.clientId,
        grant: grant.grant,
        access: { organization, owner: organizationOwner(organization), role: member.role },
      });
    });
  const access = (ctx: GenericEndpointContext, kind: "mcp" | "api") =>
    oauth.authenticate(ctx, kind).pipe(Effect.flatMap((grant) => projectAccess(ctx, grant)));
  const hosted = {
    id: "executor-hosted-grants",
    endpoints: {
      getMcpBrowserAccess: createAuthEndpoint(
        "/mcp/browser-access",
        {
          method: "POST",
          requireHeaders: true,
          body: Schema.toStandardSchemaV1(Schema.Struct({ id: GrantId })),
          metadata: { SERVER_ONLY: true },
        },
        (ctx) =>
          runAuth(
            oauth.lookupBrowser(ctx).pipe(Effect.flatMap((grant) => projectAccess(ctx, grant))),
          ),
      ),
      getMcpAccess: createAuthEndpoint(
        "/mcp/access",
        { method: "GET", requireHeaders: true, metadata: { SERVER_ONLY: true } },
        (ctx) => runAuth(access(ctx, "mcp")),
      ),
      getApiAccess: createAuthEndpoint(
        "/executor-api/access",
        {
          method: "GET",
          requireHeaders: true,
          metadata: { SERVER_ONLY: true },
          query: Schema.toStandardSchemaV1(
            Schema.Struct({ organization: Schema.optional(OrganizationReference) }),
          ),
        },
        (ctx) =>
          runAuth(
            Effect.gen(function* () {
              const token = ctx.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/i)?.[1];
              const identity = yield* Effect.gen(function* () {
                if (token?.startsWith(userApiKeyPrefix)) {
                  const userId = yield* apiKeyUser(ctx, Redacted.make(token));
                  const reference = yield* Schema.decodeUnknownEffect(OrganizationReference)(
                    ctx.query.organization ?? ctx.headers.get("x-executor-organization"),
                  ).pipe(Effect.mapError(() => new APIError("FORBIDDEN")));
                  const organization = yield* resolveReference(ctx.context, reference);
                  const member = yield* membership(ctx.context, userId, organization);
                  return {
                    userId,
                    access: {
                      organization,
                      owner: organizationOwner(organization),
                      role: member.role,
                    },
                  };
                }
                const grant = yield* access(ctx, "api");
                if (
                  ctx.query.organization !== undefined &&
                  grant.access.organization !==
                    (yield* resolveReference(ctx.context, ctx.query.organization))
                )
                  return yield* Effect.fail(new APIError("FORBIDDEN"));
                return { userId: grant.userId, access: grant.access };
              });
              const value = yield* authCall(() =>
                ctx.context.adapter.findOne({
                  model: "organization",
                  where: [{ field: "id", value: identity.access.organization }],
                }),
              );
              const organization = yield* Schema.decodeUnknownEffect(
                Schema.Struct({ slug: Schema.NonEmptyString }),
              )(value).pipe(Effect.mapError(() => new APIError("FORBIDDEN")));
              return { ...identity, organizationSlug: organization.slug };
            }),
          ),
      ),
    },
  } satisfies BetterAuthPlugin;
  return [...oauth.plugins, hosted] as const;
};

/** Preserve invalid grants, denied membership, and storage outages as different outcomes. */
export const mcpAuthenticationError = (cause: unknown) =>
  isAPIError(cause) && cause.statusCode === 403
    ? new McpForbidden()
    : isAPIError(cause) && (cause.statusCode === 400 || cause.statusCode === 401)
      ? new McpUnauthorized()
      : new AuthenticationUnavailable();

/** Translate native API grant failures into the existing HTTP permission contracts. */
export const apiAuthenticationError = (cause: unknown) =>
  isAPIError(cause) && cause.statusCode === 403
    ? new OrganizationForbidden()
    : isAPIError(cause) && (cause.statusCode === 400 || cause.statusCode === 401)
      ? new Unauthorized()
      : new AuthenticationUnavailable();
