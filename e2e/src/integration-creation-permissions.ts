import { randomBytes } from "node:crypto";
import { expect } from "@effect/vitest";
import { Effect } from "effect";
import { composePluginApi } from "@executor-js/api/server";
import { openApiHttpPlugin } from "@executor-js/plugin-openapi/api";
import { IntegrationSlug } from "@executor-js/sdk/shared";

import { Api, Browser } from "./services";
import type { Identity } from "./target";
import { visit } from "./surfaces/browser";

const api = composePluginApi([openApiHttpPlugin()] as const);

/** Exercise integration creation and member restrictions through the shared console. */
export const integrationCreationPermissions = (admin: Identity, member: Identity) =>
  Effect.gen(function* () {
    const browser = yield* Browser;
    const { client } = yield* Api;
    const adminClient = yield* client(api, admin);
    const title = `Permissions API ${randomBytes(4).toString("hex")}`;
    const slug = IntegrationSlug.make(title.toLowerCase().replaceAll(" ", "_"));
    const spec = JSON.stringify({
      openapi: "3.0.3",
      info: { title, version: "1.0.0" },
      servers: [{ url: "https://api.example.com" }],
      paths: {},
      components: {
        securitySchemes: { apiKey: { type: "apiKey", in: "header", name: "X-API-Key" } },
      },
      security: [{ apiKey: [] }],
    });

    yield* Effect.ensuring(
      Effect.gen(function* () {
        yield* browser.session(admin, async ({ page, step }) => {
          await step("Admin opens the integration catalog", async () => {
            await visit(page, "/");
            await page.getByRole("button", { name: "Browse integrations", exact: true }).waitFor();
            await page.keyboard.press("ControlOrMeta+k");
            await page.getByRole("option", { name: /^Add OpenAPI/ }).waitFor();
            await page.keyboard.press("Escape");
            await page.getByRole("link", { name: "Add integration", exact: true }).click();
            await page.getByRole("heading", { name: "Add an integration", exact: true }).waitFor();
            await page
              .getByRole("textbox", { name: "Search integrations, or paste a URL" })
              .waitFor();
          });
          await step("Admin creates an integration from the setup form", async () => {
            await visit(page, "/integrations/add/openapi");
            await page.getByPlaceholder("https://api.example.com/openapi.json").fill(spec);
            await page.getByRole("button", { name: "Add integration", exact: true }).click();
            await page.waitForURL((url) => url.pathname.endsWith(`/integrations/${slug}`), {
              timeout: 30_000,
            });
            await page.getByRole("button", { name: "Edit", exact: true }).waitFor();
            await page.getByRole("button", { name: "Delete", exact: true }).waitFor();
          });
        });
        expect(yield* adminClient.integrations.get({ params: { slug } })).toMatchObject({
          name: title,
        });

        yield* browser.session(member, async ({ page, step }) => {
          await step("Member sees existing integrations without an Add action", async () => {
            await visit(page, "/");
            await page.getByRole("heading", { name: "Integrations", exact: true }).waitFor();
            await page.getByTestId(`integration-entry-${slug}`).waitFor();
            expect(
              await page.getByRole("button", { name: "Browse integrations", exact: true }).count(),
            ).toBe(0);
            await page.keyboard.press("ControlOrMeta+k");
            const palette = page.getByRole("dialog");
            await palette.getByRole("option", { name: new RegExp(title) }).waitFor();
            expect(await palette.getByRole("option", { name: /^Add / }).count()).toBe(0);
            expect(await palette.getByText("Popular integrations", { exact: true }).count()).toBe(
              0,
            );
            await page.keyboard.press("Escape");
            expect(await page.getByRole("link", { name: /^Add (an? )?integration$/ }).count()).toBe(
              0,
            );
          });
          await step(
            "Member opens an existing integration and can add a personal connection",
            async () => {
              await page.getByTestId(`integration-entry-${slug}`).click();
              await page.getByRole("button", { name: "Add connection", exact: true }).waitFor();
              expect(await page.getByRole("button", { name: /^(Edit|Delete)$/ }).count()).toBe(0);
              await page.getByRole("button", { name: "Add connection", exact: true }).click();
              const dialog = page.getByRole("dialog");
              await dialog.waitFor();
              expect(await dialog.getByText("Workspace", { exact: true }).count()).toBe(0);
            },
          );
          for (const path of [
            "/integrations/browse",
            "/integrations/add/openapi",
            "/integrations/add/mcp",
          ]) {
            await step(`Member follows ${path} and sees the admin explanation`, async () => {
              await visit(page, path);
              await page.getByRole("heading", { name: "An admin must add integrations" }).waitFor();
              expect(await page.getByRole("textbox").count()).toBe(0);
              expect(await page.getByRole("button", { name: /^Add/ }).count()).toBe(0);
            });
          }
          await step("Member returns to their existing integrations", async () => {
            await page.getByRole("link", { name: "Back to integrations" }).click();
            await page.getByRole("heading", { name: "Integrations", exact: true }).waitFor();
          });
        });
      }),
      adminClient.openapi.removeSpec({ params: { slug } }).pipe(Effect.ignore),
    );
  });
