/** Owner lifecycle. Products call this when an owner itself stops existing. */
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";
import { OwnerId, StorageError, WebhookId } from "./shared.ts";
import { AppWorkflowsActive } from "./apps.ts";
import { AccountWorkflowsActive } from "./account.ts";

/** Live provider registrations must be removed first; this operation never silently abandons them. */
export class OwnerWebhooksActive extends Schema.TaggedError<OwnerWebhooksActive>()(
  "OwnerWebhooksActive",
  { owner: OwnerId, subscriptions: Schema.Array(WebhookId) },
  { httpApiStatus: 409 },
) {}

/** What the purge actually deleted, so a product can report and verify the result. */
export const OwnerRemoved = Schema.Struct({
  owner: OwnerId,
  apps: Schema.Int,
  accounts: Schema.Int,
  deployments: Schema.Int,
  connections: Schema.Int,
});
export type OwnerRemoved = typeof OwnerRemoved.Type;

/** Decoded at the Promise boundary; the native operation takes the parsed value. */
export const OwnerInputs = { remove: Schema.Struct({ owner: OwnerId }) };

/** Ownership is a storage primitive, not authorization; the caller decides who may do this. */
export const OwnersGroup = HttpApiGroup.make("owners").add(
  HttpApiEndpoint.delete("remove", "/v1/owners/:owner", {
    params: { owner: OwnerId },
    success: OwnerRemoved,
    error: [StorageError, OwnerWebhooksActive, AppWorkflowsActive, AccountWorkflowsActive],
  }).annotate(
    OpenApi.Description,
    "Delete every record belonging to one owner: configured apps, app records, stopped webhooks, saved accounts and their credentials, retained deployments, pending connections, pending approvals and completed workflow runs. Remove live webhook subscriptions and finish or terminate active workflows first. Repeating removal is safe.",
  ),
);
