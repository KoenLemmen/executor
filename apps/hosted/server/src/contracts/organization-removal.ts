/** Removing an organization is a separate capability; a host composes it only where it applies. */
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";
import { OwnerWebhooksActive, WebhookErrors } from "@executor-js/sdk/core";
import { AuthenticationUnavailable } from "./auth.ts";
import {
  OrganizationForbidden,
  OrganizationIconUnavailable,
  OrganizationId,
  OrganizationReference,
  RequireOrganization,
} from "./organization.ts";

/** What the organization held when it was removed, so the browser can report a real result. */
export const OrganizationRemoved = Schema.Struct({
  organization: OrganizationId,
  apps: Schema.Int,
  accounts: Schema.Int,
});
export type OrganizationRemoved = typeof OrganizationRemoved.Type;

/** Owner-only, irreversible, and complete: no product record survives the organization. */
export const HostedOrganizationRemoval = HttpApiGroup.make("organizationRemoval")
  .add(
    HttpApiEndpoint.delete("remove", "/api/organizations/:organization", {
      params: { organization: OrganizationReference },
      success: OrganizationRemoved,
      error: [
        OrganizationForbidden,
        OrganizationIconUnavailable,
        AuthenticationUnavailable,
        OwnerWebhooksActive,
        ...WebhookErrors,
      ],
    }).annotate(
      OpenApi.Description,
      "Delete an organization with every app, account, credential, deployment and MCP grant it owns. Requires the owner role. Live webhook subscriptions are removed at their providers first; a provider that refuses leaves the organization intact.",
    ),
  )
  .middleware(RequireOrganization);
