/** Common hosted contracts. Product reads require a hosted session. */
import { CatalogEntry, CatalogUnavailable } from "@executor-js/catalog/contracts";
import { JsonObject } from "@executor-js/sdk/core";
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";
import { AuthenticationUnavailable, Principal, RequireUser, Unauthorized } from "./auth.ts";
import {
  HostedOrganization,
  OrganizationForbidden,
  OrganizationId,
  OrganizationRole,
} from "./organization.ts";
import { HostedApps } from "./apps.ts";
import { HostedAccounts } from "./accounts.ts";
import { HostedAppData } from "./app-data.ts";
import { HostedWebhookSetup } from "./webhook-setup.ts";
import { HostedWebhooks } from "./webhooks.ts";
import { HostedTools } from "./tools.ts";
import { HostedSkills } from "./skills.ts";

/** Process liveness only; this does not probe integrations.sh or future storage. */
export const Health = Schema.Struct({ status: Schema.Literal("ok") });

/** Describe OAuth only on organization routes; browser-only routes retain their own policy. */
export const organizationOAuthDocument = (
  input: Record<string, unknown>,
): Record<string, unknown> => {
  const document = Schema.decodeUnknownSync(
    Schema.Struct({
      paths: Schema.Record(Schema.String, Schema.Record(Schema.String, JsonObject)),
      components: JsonObject,
    }),
  )(input);
  return {
    ...input,
    components: {
      ...document.components,
      securitySchemes: {
        ...Schema.decodeUnknownSync(Schema.Record(Schema.String, JsonObject))(
          document.components.securitySchemes,
        ),
        oauth: {
          type: "oauth2",
          flows: {
            authorizationCode: {
              authorizationUrl: "/api/auth/oauth2/authorize",
              tokenUrl: "/api/auth/oauth2/token",
              scopes: {
                executor: "Manage Executor apps and accounts in the selected organization",
              },
            },
          },
        },
      },
    },
    paths: Object.fromEntries(
      Object.entries(document.paths).map(([path, methods]) => [
        path,
        path.startsWith("/api/organizations/") || path === "/api/context"
          ? Object.fromEntries(
              Object.entries(methods).map(([method, operation]) => [
                method,
                { ...operation, security: [{ oauth: ["executor"] }] },
              ]),
            )
          : methods,
      ]),
    ),
  };
};

/** Common API contract; each host extends it with its own groups. */
export const HostedApi = HttpApi.make("executor-hosted")
  .add(
    HostedWebhookSetup,
    HostedWebhooks,
    HostedApps,
    HostedSkills,
    HostedAccounts,
    HostedTools,
    HostedOrganization,
    HostedAppData,
  )
  .add(
    HttpApiGroup.make("context").add(
      HttpApiEndpoint.get("get", "/api/context", {
        success: Schema.Struct({
          organization: OrganizationId,
          slug: Schema.NonEmptyString,
          role: OrganizationRole,
        }),
        error: [Unauthorized, OrganizationForbidden, AuthenticationUnavailable],
      }),
    ),
  )
  .annotate(OpenApi.Transform, organizationOAuthDocument)
  .add(HttpApiGroup.make("health").add(HttpApiEndpoint.get("get", "/health", { success: Health })))
  .add(
    HttpApiGroup.make("viewer")
      .annotate(OpenApi.Exclude, true)
      .add(HttpApiEndpoint.get("get", "/api/viewer", { success: Principal }))
      .middleware(RequireUser),
  )
  .add(
    HttpApiGroup.make("catalog")
      .annotate(OpenApi.Exclude, true)
      .add(
        HttpApiEndpoint.get("list", "/api/catalog", {
          success: Schema.Array(CatalogEntry),
          error: CatalogUnavailable,
        }),
      )
      .middleware(RequireUser),
  );
