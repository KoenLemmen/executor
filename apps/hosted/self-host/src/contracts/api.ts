import { HostedApi } from "@executor-js/hosted-server/contracts";
import { OpenApi } from "effect/unstable/httpapi";

/** SelfHost API contract. Extend the common API here with host-specific groups. */
export const SelfHostApi = HostedApi.annotate(OpenApi.Title, "Executor Self-host");
