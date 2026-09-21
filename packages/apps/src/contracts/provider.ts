/** Provider declarations use native Effect schemas. The trusted host interprets them. */
import { Data, Schema } from "effect";
import { type AccountId, HttpUrl } from "./schema.ts";

/** A named secrets method; its schema retains the provider's own field names. */
export class SecretsMethod<Fields extends Schema.Decoder<unknown>> extends Data.TaggedClass(
  "secrets",
)<{
  readonly label: string;
  readonly fields: Fields;
}> {}

/** OAuth endpoint configuration, independent of the host's approved OAuth client. */
export const OAuth2Config = Schema.Union([
  Schema.Struct({
    discover: HttpUrl,
    authorizationUrl: Schema.optional(Schema.Never),
    tokenUrl: Schema.optional(Schema.Never),
    scopes: Schema.optional(Schema.Never),
  }),
  Schema.Struct({
    authorizationUrl: HttpUrl,
    tokenUrl: HttpUrl,
    scopes: Schema.Array(Schema.String),
    discover: Schema.optional(Schema.Never),
  }),
]);
export type OAuth2Config = typeof OAuth2Config.Type;

/** Default app-visible OAuth projection. Refresh tokens and client secrets remain with the host. */
export const OAuth2AccessToken = Schema.Struct({ access_token: Schema.String });

/** OAuth declaration with an explicit schema for app-visible account fields. */
export class OAuth2Method<Response extends Schema.Decoder<unknown>> extends Data.TaggedClass(
  "oauth2",
)<{
  readonly config: OAuth2Config;
  readonly response: Response;
}> {}

/** Supported declarations; these acquire credentials rather than normalize them. */
export type AuthMethod =
  | SecretsMethod<Schema.Decoder<unknown>>
  | OAuth2Method<Schema.Decoder<unknown>>;

/** Auth method names are chosen by the provider author. */
export type AuthMethods = Readonly<Record<string, AuthMethod>>;

/** A provider declaration. The future host derives its identity from normalized content. */
export class Provider<Auth extends AuthMethods> extends Data.Class<{
  readonly name: string;
  readonly auth: Auth;
}> {
  /** Declare zero or more accounts from this provider without performing I/O. */
  many(): ManyAccounts<Auth> {
    return new ManyAccounts({ provider: this });
  }
}

/** A collection requirement; selecting accounts does not copy or transfer them. */
export class ManyAccounts<Auth extends AuthMethods> extends Data.TaggedClass("many")<{
  readonly provider: Provider<Auth>;
}> {}

/** Infer the data for one method from its native Effect decoder. */
export type AuthMethodData<Method> =
  Method extends SecretsMethod<infer Fields>
    ? Fields["Type"]
    : Method extends OAuth2Method<infer Response>
      ? Response["Type"]
      : never;

/** One selected account, discriminated by its author-chosen method name. */
export type AccountOf<P> =
  P extends Provider<infer Auth>
    ? {
        readonly [Method in keyof Auth & string]: {
          readonly id: AccountId;
          readonly method: Method;
          readonly fields: AuthMethodData<Auth[Method]>;
        };
      }[keyof Auth & string]
    : never;
