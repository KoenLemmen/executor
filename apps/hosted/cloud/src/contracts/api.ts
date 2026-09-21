import { HostedApi } from "@executor-js/hosted-server/contracts";
import { HostedOrganizationRemoval } from "@executor-js/hosted-server";
import { billingGroup } from "./billing.ts";
import { onboardingGroup } from "./onboarding.ts";
import { OpenApi } from "effect/unstable/httpapi";

/** Cloud API contract. Extend the common API here with host-specific groups. */
export const CloudApi = HostedApi.add(billingGroup)
  .add(onboardingGroup)
  .add(HostedOrganizationRemoval)
  .annotate(OpenApi.Title, "Executor Cloud");
