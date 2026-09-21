import { billingHandlers } from "./billing.ts";
import { onboardingHandlers } from "./onboarding-handlers.ts";
import { organizationRemovalHandlers } from "./organization-removal.ts";
import { hostedHandlers } from "@executor-js/hosted-server";
import { Layer } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { CloudApi } from "../contracts/api.ts";

/** Register this host's complete API and one OpenAPI document. */
export const cloudApi = HttpApiBuilder.layer(CloudApi, { openapiPath: "/openapi.json" }).pipe(
  Layer.provide(
    Layer.mergeAll(
      hostedHandlers,
      billingHandlers,
      onboardingHandlers,
      organizationRemovalHandlers,
    ),
  ),
);
