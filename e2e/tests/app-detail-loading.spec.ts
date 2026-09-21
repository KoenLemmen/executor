import { expect, layer } from "@effect/vitest";
import { Effect } from "effect";
import { randomUUID } from "node:crypto";
import { Actors } from "../support/actors.ts";
import { Api, body } from "../support/api.ts";
import { Browser } from "../support/browser.ts";
import { HostedLive, withCase } from "../support/case.ts";
import { App } from "../support/contracts.ts";
import { holdQuery } from "../support/query-transition.ts";
import { scenarios } from "../test-plan.ts";

layer(HostedLive, { excludeTestServices: true })("App detail navigation", (it) => {
  it.effect(scenarios.appDetailLoading.title, (context) =>
    withCase(
      context,
      Effect.gen(function* () {
        const actors = yield* Actors;
        const api = yield* Api;
        const browser = yield* Browser;
        const prefix = `/api/organizations/${actors.organization.id}`;
        const deployed = yield* api.request(actors.owner, "POST", `${prefix}/apps/deploy`, {
          name: `Loading example ${randomUUID().slice(0, 8)}`,
          files: [
            {
              path: "index.ts",
              content: `
import { defineApp, query, object } from "apps";
export default defineApp({ accounts: {} }, async () => ({
  name: "Loading example",
  queries: { hello: query({ description: "A simple greeting", input: object({}) }, async () => "Hello") }
}));`,
            },
          ],
        });
        expect(deployed.status).toBe(200);
        const app = yield* body(App, deployed);
        yield* Effect.addFinalizer(() =>
          api.request(actors.owner, "DELETE", `${prefix}/apps/${app.id}`).pipe(
            Effect.tap((response) => Effect.sync(() => expect(response.status).toBe(200))),
            Effect.orDie,
          ),
        );
        yield* browser.login(actors.owner);
        for (const viewport of [
          { width: 1440, height: 900 },
          { width: 390, height: 844 },
        ]) {
          yield* browser.use("Set the viewport", (page) => page.setViewportSize(viewport));
          yield* browser.use("Open installed apps", (page) =>
            page.goto(`/org/${actors.organization.slug}/apps`),
          );
          yield* browser.use("The app card is available", (page) =>
            page.getByRole("link", { name: `Open ${app.name}`, exact: true }).waitFor(),
          );
          const paths = [actors.organization.slug, actors.organization.id].map(
            (reference) => `/api/organizations/${reference}/apps/${app.id}`,
          );
          const metadata = yield* holdQuery(paths, "continue");
          const tools = yield* holdQuery(
            paths.map((path) => `${path}/tools`),
            "continue",
          );
          yield* browser.checkpoint("Installed app before opening details");
          yield* browser.use("Click the installed app", (page) =>
            page.getByRole("link", { name: `Open ${app.name}`, exact: true }).click(),
          );
          yield* metadata.requested;
          yield* browser.checkpoint("App details while metadata is held");
          const heading = yield* browser.use(
            "The known app name remains visible while loading",
            (page) => page.getByRole("heading", { name: app.name, exact: true }).boundingBox(),
          );
          expect(heading).not.toBeNull();
          const tabs = yield* browser.use("Tabs are already visible", (page) =>
            page.getByRole("tablist").boundingBox(),
          );
          expect(tabs).not.toBeNull();
          yield* browser.use("Back navigation is usable", (page) =>
            page.locator(".detail-page").getByRole("link", { name: "Apps", exact: true }).waitFor(),
          );
          const panel = yield* browser.use("Pending panel geometry", (page) =>
            page.getByRole("status", { name: "Loading app", exact: true }).boundingBox(),
          );
          expect(panel).not.toBeNull();
          yield* metadata.release;
          yield* tools.requested;
          yield* browser.checkpoint("App details while tools are held");
          yield* browser.use("Search is available before tools arrive", (page) =>
            page.getByPlaceholder("Search tools…").fill("hello"),
          );
          yield* tools.release;
          yield* browser.use("The real tool loads", (page) =>
            page.getByRole("button", { name: "hello A simple greeting" }).waitFor(),
          );
          expect(
            yield* browser.use("Search survives loading", (page) =>
              page.getByPlaceholder("Search tools…").inputValue(),
            ),
          ).toBe("hello");
          const loadedHeading = yield* browser.use("Loaded heading geometry", (page) =>
            page.getByRole("heading", { name: app.name, exact: true }).boundingBox(),
          );
          const loadedTabs = yield* browser.use("Loaded tab geometry", (page) =>
            page.getByRole("tablist").boundingBox(),
          );
          const loadedPanel = yield* browser.use("Loaded panel geometry", (page) =>
            page.locator(".tool-browser").boundingBox(),
          );
          expect(loadedPanel?.y).toBe(panel?.y);
          expect(loadedPanel?.height).toBe(panel?.height);
          expect(loadedHeading?.y).toBe(heading?.y);
          expect(loadedTabs?.y).toBe(tabs?.y);
          yield* browser.checkpoint("Loaded details retain the heading and tabs");
        }
      }),
    ),
  );
});
