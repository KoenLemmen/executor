/** URL transport policy shared by hosts. It does not grant access or replace protocol rules. */
import { Config, Schema } from "effect";

/** Classify a WHATWG URL hostname without DNS. Reserved localhost names and loopback IPs only. */
export const isLoopbackHostname = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "[::1]" ||
    /^127(?:\.(?:\d{1,2}|1\d\d|2[0-4]\d|25[0-5])){3}$/.test(host)
  );
};

/** An exact HTTP origin, including its port. No paths, credentials, wildcards, query or fragment. */
export const HttpOrigin = Schema.String.check(
  Schema.makeFilter(
    (value) => {
      const url = URL.parse(value);
      return (
        url !== null &&
        url.protocol === "http:" &&
        !url.hostname.includes("*") &&
        url.origin === value
      );
    },
    { message: "Expected an exact HTTP origin, without a trailing slash" },
  ),
).pipe(Schema.brand("HttpOrigin"));
export type HttpOrigin = typeof HttpOrigin.Type;

/** Trusted host policy. Explicit HTTP origins never imply access to sibling hosts or other ports. */
export const UrlPolicy = Schema.Struct({
  allowLoopbackHttp: Schema.Boolean,
  allowedHttpOrigins: Schema.Array(HttpOrigin),
});
export type UrlPolicy = typeof UrlPolicy.Type;

/** HTTPS everywhere, with HTTP for reserved loopback hosts regardless of deployment mode. */
export const defaultUrlPolicy: UrlPolicy = { allowLoopbackHttp: true, allowedHttpOrigins: [] };
/** Use where a protocol requires HTTPS even when the host allows other HTTP endpoints. */
export const httpsOnlyUrlPolicy: UrlPolicy = { allowLoopbackHttp: false, allowedHttpOrigins: [] };

/** Parse an absolute endpoint under host policy; reject userinfo and fragments, preserve queries. */
export const parseEndpoint = (
  value: string,
  policy: UrlPolicy = defaultUrlPolicy,
): URL | undefined => {
  const url = URL.parse(value);
  if (url === null || url.username || url.password || url.href.includes("#")) return undefined;
  if (
    url.protocol === "https:" ||
    (url.protocol === "http:" &&
      ((policy.allowLoopbackHttp && isLoopbackHostname(url.hostname)) ||
        policy.allowedHttpOrigins.some((origin) => origin === url.origin)))
  )
    return url;
  return undefined;
};

/** Shared local, self-host and Cloud environment settings. Invalid entries fail startup/deploy. */
export const urlPolicyConfig = Config.all({
  allowLoopbackHttp: Config.Boolean("EXECUTOR_URL_ALLOW_LOOPBACK_HTTP").pipe(
    Config.withDefault(defaultUrlPolicy.allowLoopbackHttp),
  ),
  allowedHttpOrigins: Config.schema(
    Schema.fromJsonString(Schema.Array(HttpOrigin)),
    "EXECUTOR_URL_ALLOW_HTTP_ORIGINS",
  ).pipe(Config.withDefault(defaultUrlPolicy.allowedHttpOrigins)),
});
