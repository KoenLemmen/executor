import { expect, layer } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { randomUUID } from "node:crypto";
import { Actors } from "../support/actors.ts";
import { Api, body } from "../support/api.ts";
import { Browser } from "../support/browser.ts";
import { HostedLive, withCase } from "../support/case.ts";
import { App, Resource } from "../support/contracts.ts";
import { Evidence } from "../support/evidence.ts";
import { holdQuery } from "../support/query-transition.ts";
import { scenarios } from "../test-plan.ts";

layer(HostedLive, { excludeTestServices: true })("Account connection", (it) => {
  it.effect(scenarios.accountConnectionQuery.title, (context) =>
    withCase(
      context,
      Effect.gen(function* () {
        const actors = yield* Actors;
        const api = yield* Api;
        const browser = yield* Browser;
        const evidence = yield* Evidence;
        const prefix = `/api/organizations/${actors.organization.id}`;
        const name = `Connection ${randomUUID().slice(0, 8)}`;
        const deployed = yield* api.request(actors.owner, "POST", `${prefix}/apps/deploy`, {
          name,
          files: [
            {
              path: "index.ts",
              content: `
import { defineApp, defineProvider, mutation, object, secrets, string } from "apps";
const service = defineProvider({ name: "Connection fixture", auth: {
  key: secrets({ label: "API key", fields: object({ token: string() }) })
} });
export default defineApp({ accounts: { service } }, async ({ accounts }) => ({
  name: "Connection fixture",
  mutations: { echo: mutation({ description: "Echo with the connected account", input: object({ text: string() }) },
    async (_, input) => ({ text: input.text, connected: accounts.service.fields.token === "synthetic-connection-token" })) }
}));
`,
            },
          ],
        });
        expect(deployed.status).toBe(200);
        const app = yield* body(App, deployed);
        let account: string | undefined;
        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            expect(
              (yield* api.request(actors.owner, "DELETE", `${prefix}/apps/${app.id}`)).status,
            ).toBe(200);
            if (account !== undefined)
              expect(
                (yield* api.request(actors.owner, "DELETE", `${prefix}/accounts/${account}`))
                  .status,
              ).toBe(200);
          }).pipe(Effect.orDie),
        );
        yield* browser.login(actors.owner);
        yield* browser.use("Open the new app before connecting its account", (page) =>
          page.goto(`/org/${actors.organization.slug}/apps/${app.id}`),
        );
        yield* browser.use("Open account setup from the app", (page) =>
          page.getByRole("link", { name: "Choose accounts", exact: true }).click(),
        );
        yield* browser.use("Leave app setup to connect an account", (page) =>
          page.getByRole("button", { name: "Add account", exact: true }).click(),
        );
        yield* browser.use("The credential form replaces app setup", (page) =>
          page
            .getByRole("heading", { name: "Connect Connection fixture", exact: true })
            .waitFor({ state: "visible" }),
        );
        yield* browser.use("Name the synthetic account", (page) =>
          page.getByRole("textbox", { name: "Account name", exact: true }).fill(name),
        );
        yield* browser.use("Enter the synthetic API key", (page) =>
          page.getByLabel("Token", { exact: true }).fill("synthetic-connection-token"),
        );
        const timeOrigin = yield* browser.use("Remember this document before saving", (page) =>
          page.evaluate(() => performance.timeOrigin),
        );
        const paths = [actors.organization.slug, actors.organization.id].map(
          (reference) => `/api/organizations/${reference}/apps/${app.id}`,
        );
        const read = yield* holdQuery(paths, "continue");
        const saved = yield* browser.use("Save credentials through the account form", (page) =>
          Promise.all([
            page.waitForResponse(
              (response) =>
                response.request().method() === "POST" &&
                new URL(response.url()).pathname.endsWith("/submit"),
            ),
            page.getByRole("button", { name: "Connect account", exact: true }).click(),
          ]).then(([response]) =>
            response.json().then((value: unknown) => ({ status: response.status(), body: value })),
          ),
        );
        expect(saved.status).toBe(200);
        account = (yield* Schema.decodeUnknownEffect(Resource)(saved.body)).id;
        const selected = yield* api.request(actors.owner, "GET", `${prefix}/apps/${app.id}`);
        expect(selected.status).toBe(200);
        expect(
          (yield* body(
            Schema.Struct({ accounts: Schema.Struct({ service: Schema.String }) }),
            selected,
          )).accounts.service,
        ).toBe(account);
        yield* browser.use("Saving returns to the app without a document navigation", (page) =>
          page.waitForURL(
            (url) => url.pathname === `/org/${actors.organization.slug}/apps/${app.id}`,
          ),
        );
        yield* browser.checkpoint("App waits for refreshed account selection");
        const refreshPath = yield* evidence.step(
          "Saving starts a fresh app metadata read",
          read.requested,
        );
        yield* browser.use("The pending app read has a loading state", (page) =>
          page
            .getByRole("status", { name: "Loading app", exact: true })
            .waitFor({ state: "visible" }),
        );
        yield* read.release;
        yield* browser.use("The connected app's tools load without refreshing", (page) =>
          page
            .getByRole("button", {
              name: "mutations.echo Echo with the connected account",
              exact: true,
            })
            .waitFor({ state: "visible" }),
        );
        yield* browser.use("App loading clears after the read finishes", (page) =>
          page
            .getByRole("status", { name: "Loading app", exact: true })
            .waitFor({ state: "hidden" }),
        );
        expect(
          yield* browser.use("The original document remains mounted", (page) =>
            page.evaluate(() => performance.timeOrigin),
          ),
        ).toBe(timeOrigin);
        yield* browser.checkpoint("Connected app tools loaded without refresh");
        yield* evidence.json("account-connection-query.json", {
          refreshPath,
          accountSelected: true,
          toolsVisibleWithoutReload: true,
        });
      }),
    ),
  );
});
