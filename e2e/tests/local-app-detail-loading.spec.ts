import { expect, layer } from "@effect/vitest";
import { Effect, Redacted, Schema } from "effect";
import { randomUUID } from "node:crypto";
import { Api, body } from "../support/api.ts";
import { Browser } from "../support/browser.ts";
import { TestLive, withCase } from "../support/case.ts";
import { Resource } from "../support/contracts.ts";
import { Target } from "../support/platform.ts";
import { holdQuery } from "../support/query-transition.ts";
import { scenarios } from "../test-plan.ts";

layer(TestLive, { excludeTestServices: true })("Local app navigation", (it) => {
  it.effect(scenarios.localAppDetailLoading.title, (context) =>
    withCase(
      context,
      Effect.gen(function* () {
        const api = yield* Api;
        const browser = yield* Browser;
        const target = yield* Target;
        const session = yield* api.session();
        const headers = { authorization: `Bearer ${Redacted.value(target.apiKey)}` };
        const name = `Example ${randomUUID().slice(0, 4)}`;
        const deployed = yield* session.send(
          "POST",
          "/v1/apps/deploy",
          {
            owner: "local",
            name,
            files: [
              {
                path: "index.ts",
                content: `
import { defineApp, query, object } from "apps";
export default defineApp({ accounts: {} }, async () => ({
  name: "Example",
  queries: { hello: query({ description: "A simple greeting", input: object({}) }, async () => "Hello") }
}));`,
              },
            ],
          },
          headers,
        );
        expect(deployed.status).toBe(200);
        const { app } = yield* body(Schema.Struct({ app: Resource }), deployed);
        yield* Effect.addFinalizer(() =>
          session.send("DELETE", `/v1/apps/${app.id}`, undefined, headers).pipe(
            Effect.tap((response) => Effect.sync(() => expect(response.status).toBe(200))),
            Effect.orDie,
          ),
        );
        const pairing = yield* session.send("POST", "/auth/pair", undefined, headers);
        expect(pairing.status).toBe(200);
        const { url } = yield* body(Schema.Struct({ url: Schema.String }), pairing);
        yield* browser.use("Pair the local browser", (page) => page.goto(url));
        for (const viewport of [
          { width: 1440, height: 900 },
          { width: 390, height: 844 },
        ]) {
          yield* browser.use("Set the viewport", (page) => page.setViewportSize(viewport));
          yield* browser.use("Open apps", (page) => page.goto("/apps"));
          yield* browser.use("The app card is available", (page) =>
            page.getByRole("link", { name: `Open ${name}`, exact: true }).waitFor(),
          );
          const metadata = yield* holdQuery([`/dashboard/api/live/apps/${app.id}`], "continue");
          const tools = yield* holdQuery([`/dashboard/api/live/apps/${app.id}/tools`], "continue");
          yield* browser.checkpoint("Local apps before opening details");
          yield* browser.use("Click the installed app", (page) =>
            page.getByRole("link", { name: `Open ${name}`, exact: true }).click(),
          );
          yield* metadata.requested;
          yield* browser.use("The app name stays visible", (page) =>
            page.getByRole("heading", { name, exact: true }).waitFor(),
          );
          yield* browser.use("App loading has its own panel", (page) =>
            page.getByRole("status", { name: "Loading app", exact: true }).waitFor(),
          );
          expect(
            yield* browser.use("No unrelated list skeleton", (page) =>
              page.locator(".loading-rows").count(),
            ),
          ).toBe(0);
          yield* browser.checkpoint("Local details with metadata held");
          yield* metadata.release;
          yield* tools.requested;
          yield* browser.use("Tool loading keeps the content panel", (page) =>
            page.getByRole("status", { name: "Loading tools", exact: true }).waitFor(),
          );
          yield* browser.use("Search works during loading", (page) =>
            page.getByPlaceholder("Search tools…").fill("hello"),
          );
          yield* browser.checkpoint("Local details with tools held");
          yield* tools.release;
          yield* browser.use("The real tool appears", (page) =>
            page.getByRole("button", { name: "hello A simple greeting" }).waitFor(),
          );
          expect(
            yield* browser.use("Search is retained", (page) =>
              page.getByPlaceholder("Search tools…").inputValue(),
            ),
          ).toBe("hello");
          yield* browser.checkpoint("Local loaded app details");
        }
      }),
    ),
  );
});
