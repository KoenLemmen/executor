import { scenarios } from "../test-plan.ts";
import { expect, layer } from "@effect/vitest";
import { Effect, Redacted, Schema } from "effect";
import { Api, body, BrowserCookies } from "../support/api.ts";
import { Browser } from "../support/browser.ts";
import { Target } from "../support/platform.ts";
import { TestLive, withCase } from "../support/case.ts";

layer(TestLive, { excludeTestServices: true })("Local pairing", (it) => {
  it.effect(scenarios.local.title, (context) =>
    withCase(
      context,
      Effect.gen(function* () {
        const api = yield* Api,
          browser = yield* Browser,
          target = yield* Target,
          anonymous = yield* api.session();
        expect((yield* api.request(anonymous, "GET", "/dashboard/api/overview")).status).toBe(401);
        // Pair issuance is deliberately not a browser-origin request.
        const pairing = yield* anonymous.send("POST", "/auth/pair", undefined, {
          authorization: `Bearer ${Redacted.value(target.apiKey)}`,
        });
        expect(pairing.status).toBe(200);
        const { url } = yield* body(Schema.Struct({ url: Schema.String }), pairing);
        const token = new URL(url).hash.slice("#pair=".length);
        yield* browser.use("Exchange the one-use local pairing link", (page) => page.goto(url));
        yield* browser.use("The paired dashboard is visible", (page) =>
          page.getByRole("heading", { name: /^Apps/ }).waitFor({ state: "visible" }),
        );
        const cookies = yield* browser.use("Read the paired browser session", (page) =>
          page.context().cookies(),
        );
        const paired = yield* api.session(
          Redacted.make(yield* Schema.decodeUnknownEffect(BrowserCookies)(cookies)),
        );
        expect((yield* api.request(paired, "GET", "/dashboard/api/overview")).status).toBe(200);
        expect((yield* api.request(anonymous, "POST", "/auth/exchange", { token })).status).toBe(
          401,
        );
        yield* browser.use("Reload preserves the session", (page) => page.reload());
        yield* browser.use("Dashboard remains authenticated", (page) =>
          page.getByRole("heading", { name: /^Apps/ }).waitFor({ state: "visible" }),
        );
        yield* browser.checkpoint("Local dashboard paired and ready for manual use");
      }),
    ),
  );
});
