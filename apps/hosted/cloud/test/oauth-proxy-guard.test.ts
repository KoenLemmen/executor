/** Production refuses proxied profiles and untrusted proxy redirect targets. */
import assert from "node:assert/strict";
import { test } from "node:test";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { betterAuth } from "better-auth";
import { symmetricEncrypt } from "better-auth/crypto";
import { migrateHostedSchemas } from "@executor-js/hosted-server/migrations";
import { Config, ConfigProvider, Effect, FileSystem, Redacted } from "effect";
import { selfHostDatabase } from "../../self-host/src/database.ts";
import { AuthDatabase } from "../../self-host/src/contracts/database.ts";
import { cloudAuthOptions, cloudAuthSettings } from "../src/implementation/auth-options.ts";

const origin = "https://cloud.example.test";
const proxySecret = "synthetic-oauth-proxy-secret-1234567890";
const baseConfig = {
  BETTER_AUTH_URL: origin,
  BETTER_AUTH_SECRET: "synthetic-cloud-auth-secret-1234567890",
  GOOGLE_CLIENT_ID: "google-fixture",
  GOOGLE_CLIENT_SECRET: "google-fixture-secret",
  GITHUB_CLIENT_ID: "github-fixture",
  GITHUB_CLIENT_SECRET: "github-fixture-secret",
  OAUTH_PROXY_SECRET: proxySecret,
  AUTH_TRUSTED_ORIGINS: "https://*.executor.engineering",
};

const settingsFor = (productionUrl: string) =>
  cloudAuthSettings.pipe(
    Effect.provideService(
      ConfigProvider.ConfigProvider,
      ConfigProvider.fromUnknown({ ...baseConfig, OAUTH_PROXY_PRODUCTION_URL: productionUrl }),
    ),
  );

/** What a stage's sign-in hook would place in the provider `state` parameter. */
const proxyState = async (callbackURL: string) => {
  const stateCookie = await symmetricEncrypt({
    key: proxySecret,
    data: JSON.stringify({
      callbackURL,
      codeVerifier: "verifier",
      errorURL: `${callbackURL}/login`,
      oauthState: "bound-to-a-different-state",
    }),
  });
  return symmetricEncrypt({
    key: proxySecret,
    data: JSON.stringify({ state: "attacker-state", stateCookie, isOAuthProxy: true }),
  });
};

test("the guard is installed on production only, ahead of the proxy plugin", async () => {
  const production = cloudAuthOptions(
    await Effect.runPromise(settingsFor(origin)),
    [],
    () => Effect.void,
  );
  const ids = production.plugins.map((plugin) => plugin.id);
  assert.ok(ids.indexOf("executor-oauth-proxy-production-guard") < ids.indexOf("oauth-proxy"));

  const stage = cloudAuthOptions(
    await Effect.runPromise(settingsFor("https://v2.example.test")),
    [],
    () => Effect.void,
  );
  assert.ok(stage.plugins.some((plugin) => plugin.id === "oauth-proxy"));
  assert.ok(!stage.plugins.some((plugin) => plugin.id === "executor-oauth-proxy-production-guard"));
});

test("production rejects proxy completion and untrusted proxy redirects", { timeout: 60_000 }, () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped({ prefix: "executor-oauth-proxy-" });
        const config = ConfigProvider.fromUnknown({
          EXECUTOR_DATA_DIR: directory,
          ...baseConfig,
          OAUTH_PROXY_PRODUCTION_URL: origin,
        });
        yield* Effect.gen(function* () {
          const database = yield* AuthDatabase;
          const settings = yield* cloudAuthSettings;
          const secret = yield* Config.Redacted("BETTER_AUTH_SECRET");
          const options = {
            ...cloudAuthOptions(settings, [], () => Effect.void),
            database,
            secret: Redacted.value(secret),
          };
          yield* migrateHostedSchemas(options);
          const auth = betterAuth(options);
          const get = (path: string) =>
            Effect.promise(() =>
              auth.handler(new Request(`${origin}/api/auth${path}`, { redirect: "manual" })),
            );

          // A forged profile must never create a production session, even for its own origin.
          const completion = new URLSearchParams({ callbackURL: origin, profile: "forged" });
          for (const path of ["/callback/google/oauth-proxy", "/oauth-proxy-callback"]) {
            const response = yield* get(`${path}?${completion}`);
            assert.equal(response.status, 404, path);
            assert.ok(!response.headers.getSetCookie().some((c) => c.includes("session_token")));
          }

          // The code exchange must not send tokens to an origin outside the trusted list.
          const hostile = yield* get(
            `/callback/google?code=code&state=${encodeURIComponent(
              yield* Effect.promise(() =>
                proxyState("https://attacker.example.test/api/auth/callback/google/oauth-proxy"),
              ),
            )}`,
          );
          assert.equal(hostile.status, 403);
          assert.equal(hostile.headers.get("location"), null);

          // A trusted stage still reaches the proxy plugin, which then enforces state binding.
          const trusted = yield* get(
            `/callback/google?code=code&state=${encodeURIComponent(
              yield* Effect.promise(() =>
                proxyState(
                  "https://stage.executor.engineering/api/auth/callback/google/oauth-proxy",
                ),
              ),
            )}`,
          );
          assert.equal(trusted.status, 302);
          const location = trusted.headers.get("location") ?? "";
          assert.ok(location.startsWith("https://stage.executor.engineering/"), location);
          assert.ok(location.includes("state_mismatch"));
        }).pipe(
          Effect.provide(selfHostDatabase),
          Effect.provideService(ConfigProvider.ConfigProvider, config),
        );
      }).pipe(Effect.provide(NodeServices.layer)),
    ),
  ),
);
