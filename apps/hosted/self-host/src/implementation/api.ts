import { hostedHandlers } from "@executor-js/hosted-server";
import { Layer } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { SelfHostApi } from "../contracts/api.ts";

/** Register this host's complete API and one OpenAPI document. */
export const selfHostApi = HttpApiBuilder.layer(SelfHostApi, { openapiPath: "/openapi.json" }).pipe(
  Layer.provide(hostedHandlers),
);
