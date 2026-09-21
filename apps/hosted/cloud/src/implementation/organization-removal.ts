/** Cloud is the multi-organization product, so only cloud exposes removal. */
import { removeCurrentOrganization } from "@executor-js/hosted-server";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { ExecutorCloudApi } from "../contracts/api.ts";

export const organizationRemovalHandlers = HttpApiBuilder.group(
  ExecutorCloudApi,
  "organizationRemoval",
  (handlers) => Effect.succeed(handlers.handle("remove", () => removeCurrentOrganization)),
);
