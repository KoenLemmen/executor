import { Schema } from "effect";

/** The catalog stack exports identities, never management credentials or customer data. */
export const BillingCatalog = Schema.Struct({
  environment: Schema.Literals(["sandbox", "live"]),
  namespace: Schema.NonEmptyString,
  executions: Schema.NonEmptyString,
  members: Schema.NonEmptyString,
  free: Schema.NonEmptyString,
  team: Schema.NonEmptyString,
});
/** One catalog is shared by the API and MCP runtime in the same deployment stage. */
export type BillingCatalog = typeof BillingCatalog.Type;
