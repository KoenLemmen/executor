import { Schema } from "effect";
/** Public identifier, never the bearer credential. */
export const ApiKeyId = Schema.NonEmptyString.pipe(Schema.brand("ApiKeyId"));
/** Native Better Auth key metadata; secret hashes are excluded. */
export const ApiKeySummary = Schema.Struct({
  id: ApiKeyId,
  name: Schema.NullOr(Schema.String),
  start: Schema.NullOr(Schema.String),
  enabled: Schema.Boolean,
  createdAt: Schema.String,
  expiresAt: Schema.NullOr(Schema.String),
  lastRequest: Schema.NullOr(Schema.String),
});
export type ApiKeySummary = typeof ApiKeySummary.Type;
/** PAT creation uses Better Auth's expiry duration in seconds. */
export const CreateApiKey = Schema.Struct({
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80), Schema.isPattern(/\S/)),
  expiresIn: Schema.optional(Schema.Number.check(Schema.isInt(), Schema.isGreaterThan(0))),
});
/** Only the native creation response contains the secret. */
export const CreatedApiKey = Schema.Struct({
  ...ApiKeySummary.fields,
  key: Schema.RedactedFromValue(Schema.NonEmptyString),
});
/** Native paginated response from Better Auth. */
export const ApiKeyPage = Schema.Struct({
  apiKeys: Schema.Array(ApiKeySummary),
  total: Schema.Number,
});
