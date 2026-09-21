/** Private setup shares SDK state without making secret exchange available to MCP credentials. */
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { HttpServerRequest } from "effect/unstable/http";
import type { AppId } from "@executor-js/sdk/core";
import { HostedApi } from "../contracts/api.ts";
import { Authentication } from "../contracts/auth.ts";
import {
  OrganizationForbidden,
  organizationOwner,
  type OrganizationReference,
} from "../contracts/organization.ts";
import { HostedExecutor } from "../contracts/executor.ts";
const authorized = (
  auth: typeof Authentication.Service,
  input: { organization: OrganizationReference; app: AppId },
) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const organization = yield* auth.organization(input.organization);
    const membership = yield* auth.membership(new Headers(request.headers), organization);
    if (membership.role === "member") return yield* new OrganizationForbidden();
    const executor = yield* Effect.flatten(HostedExecutor);
    yield* executor.apps.get({ owner: organizationOwner(organization), app: input.app });
    return executor;
  });
/** RequireUser owns cookie authentication and CSRF; this group owns explicit organization resource checks. */
export const hostedWebhookSetupHandlers = HttpApiBuilder.group(
  HostedApi,
  "webhookSetup",
  (handlers) =>
    Effect.gen(function* () {
      const auth = yield* Authentication;
      return handlers
        .handle("read", ({ params }) =>
          Effect.flatMap(authorized(auth, params), (executor) =>
            executor.webhookSetup.read(params),
          ),
        )
        .handle("complete", ({ params, payload }) =>
          Effect.flatMap(authorized(auth, params), (executor) =>
            executor.webhookSetup.complete({ ...params, ...payload }),
          ),
        )
        .handle("remove", ({ params }) =>
          Effect.flatMap(authorized(auth, params), (executor) => executor.webhooks.remove(params)),
        )
        .handle("confirmRemoval", ({ params }) =>
          Effect.flatMap(authorized(auth, params), (executor) =>
            executor.webhooks.confirmRemoval(params),
          ),
        );
    }),
);
