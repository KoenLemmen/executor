import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigProvider, Effect, Schema } from "effect";
import {
  defaultUrlPolicy,
  HttpOrigin,
  parseEndpoint,
  UrlPolicy,
  urlPolicyConfig,
} from "../src/url-policy.ts";

const configured: UrlPolicy = {
  allowLoopbackHttp: false,
  allowedHttpOrigins: [HttpOrigin.make("http://auth.internal:8080")],
};

test("transport defaults recognize reserved loopback hosts and reject lookalikes", () => {
  for (const host of [
    "localhost",
    "account-picker.localhost",
    "localhost.",
    "127.0.0.1",
    "127.12.0.2",
    "[::1]",
  ]) {
    assert.ok(parseEndpoint(`http://${host}:8080/callback?tenant=a`));
    assert.equal(parseEndpoint(`http://${host}:8080/callback`, configured), undefined);
  }
  for (const host of [
    "localhost.evil.test",
    "notlocalhost",
    "127.0.0.1.evil.test",
    "10.0.0.1",
    "auth.internal",
  ])
    assert.equal(parseEndpoint(`http://${host}/callback`), undefined);
  assert.ok(parseEndpoint("https://remote.test/callback?tenant=a"));
});

test("exceptions match whole origins without relaxing endpoint syntax", () => {
  assert.equal(
    parseEndpoint("http://auth.internal:8080/callback?tenant=a", configured)?.href,
    "http://auth.internal:8080/callback?tenant=a",
  );
  for (const value of [
    "http://auth.internal:8081/callback",
    "http://child.auth.internal:8080/callback",
    "http://auth.internal:8080.evil.test/callback",
    "http://user:pass@auth.internal:8080/callback",
    "http://auth.internal:8080/callback#",
    "https://safe.test/#fragment",
    "ftp://auth.internal/callback",
    "/callback",
  ])
    assert.equal(parseEndpoint(value, configured), undefined);
  for (const value of [
    "http://auth.internal/",
    "http://auth.internal/path",
    "http://auth.internal?tenant=a",
    "http://auth.internal#",
    "http://user@auth.internal",
    "http://*.internal",
    "https://auth.internal",
  ])
    assert.equal(Schema.is(HttpOrigin)(value), false, value);
});

const readConfig = (values: Record<string, string>) =>
  Effect.runPromise(
    urlPolicyConfig.pipe(
      Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromUnknown(values)),
    ),
  );

test("hosts parse the same explicit policy and reject malformed configuration", async () => {
  assert.deepEqual(await readConfig({}), defaultUrlPolicy);
  assert.deepEqual(
    await readConfig({
      EXECUTOR_URL_ALLOW_LOOPBACK_HTTP: "false",
      EXECUTOR_URL_ALLOW_HTTP_ORIGINS: '["http://auth.internal:8080"]',
    }),
    configured,
  );
  for (const value of [
    '["http://*.internal"]',
    '["http://host/path"]',
    '["https://host"]',
    '"http://host"',
    "not-json",
  ])
    await assert.rejects(readConfig({ EXECUTOR_URL_ALLOW_HTTP_ORIGINS: value }));
});
