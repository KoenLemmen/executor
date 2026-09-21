import { expect, layer } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { Api, body } from "../support/api.ts";
import { Actors } from "../support/actors.ts";
import { Browser } from "../support/browser.ts";
import { HostedLive, withCase } from "../support/case.ts";
import { Organization } from "../support/contracts.ts";
import { Evidence } from "../support/evidence.ts";
import { Onboarding } from "../support/onboarding.ts";
import { holdOrganizationEntry, waitForLastOrganization } from "../support/organization-entry.ts";
import { scenarios } from "../test-plan.ts";

layer(HostedLive, { excludeTestServices: true })("Root entry loading", (it) => {
  it.effect(scenarios.rootEntryLoading.title, (context) =>
    withCase(
      context,
      Effect.gen(function* () {
        const actors = yield* Actors;
        const api = yield* Api;
        const browser = yield* Browser;
        const evidence = yield* Evidence;
        const onboarding = yield* Onboarding;
        const organizations = yield* body(
          Schema.Array(Organization),
          yield* api.request(actors.owner, "GET", "/api/auth/organization/list"),
        );
        expect(organizations).toEqual([actors.organization]);
        yield* browser.login(actors.owner);
        yield* browser.use("Match the reported dark appearance", (page) =>
          page.emulateMedia({ colorScheme: "dark" }),
        );
        yield* browser.use("Use the reference image's logical viewport", (page) =>
          page.setViewportSize({ width: 864, height: 720 }),
        );
        yield* browser.use("Open the existing organization and populate the session hint", (page) =>
          page.goto(`/org/${actors.organization.slug}/apps`),
        );
        yield* browser.use("The signed-in user already has an Apps page", (page) =>
          page.getByRole("heading", { name: /^Apps(?:\s*\d+)?$/ }).waitFor({ state: "visible" }),
        );
        yield* waitForLastOrganization(actors.organization.id);

        // Keep the original reproduction's preparation hold installed. Entry must
        // now complete without requesting or releasing that first-team operation.
        const preparation = yield* onboarding.delayPreparation;
        const loaded = Effect.gen(function* () {
          yield* browser.use("The existing organization opens", (page) =>
            page.waitForURL(`**/org/${actors.organization.slug}/apps`),
          );
          yield* browser.use("The existing apps finish loading", (page) =>
            page.locator(".app-card").first().waitFor({ state: "visible" }),
          );
          expect(yield* preparation.wasRequested).toBe(false);
          expect(
            yield* browser.use("No first-team preparation gate", (page) =>
              page.getByRole("status", { name: "Preparing your team", exact: true }).count(),
            ),
          ).toBe(0);
        });
        yield* browser.use("Open the root URL without an organization in the path", (page) =>
          page.goto("/"),
        );
        yield* loaded;
        yield* browser.checkpoint("Existing organization opens without team preparation");

        yield* Effect.scoped(
          Effect.gen(function* () {
            const list = yield* holdOrganizationEntry;
            yield* browser.use("Reopen root before the organization list is available", (page) =>
              page.goto("/"),
            );
            yield* list.requested;
            yield* browser.use("The saved stable ID opens immediately", (page) =>
              page.waitForURL(`**/org/${actors.organization.id}/apps`),
            );
            yield* browser.use("Apps load without waiting for the organization list", (page) =>
              page.locator(".app-card").first().waitFor({ state: "visible" }),
            );
            expect(
              yield* browser.use(
                "No organization chooser blocks the remembered destination",
                (page) =>
                  page.getByRole("heading", { name: "Opening Executor", exact: true }).count(),
              ),
            ).toBe(0);
            yield* browser.checkpoint("Remembered organization loads while its list is held");
            yield* list.release;
            yield* loaded;
          }),
        );

        for (const viewport of [
          { name: "Desktop", width: 864, height: 720 },
          { name: "Mobile", width: 390, height: 844 },
        ]) {
          yield* Effect.scoped(
            Effect.gen(function* () {
              yield* browser.use("Leave the previous document", (page) => page.goto("about:blank"));
              yield* browser.login(actors.owner);
              yield* browser.use(`${viewport.name}: set the viewport`, (page) =>
                page.setViewportSize({ width: viewport.width, height: viewport.height }),
              );
              const list = yield* holdOrganizationEntry;
              yield* browser.use(
                `${viewport.name}: open root with a slow organization list`,
                (page) => page.goto("/"),
              );
              yield* list.requested;
              yield* browser.use("The entry panel explains what is loading", (page) =>
                page
                  .getByRole("heading", { name: "Opening Executor", exact: true })
                  .waitFor({ state: "visible" }),
              );
              yield* browser.use("Organization loading stays inside the entry panel", (page) =>
                page
                  .getByRole("status", { name: "Loading organizations", exact: true })
                  .waitFor({ state: "visible" }),
              );
              yield* browser.use("Sign out stays available", (page) =>
                page
                  .getByRole("button", { name: "Sign out", exact: true })
                  .waitFor({ state: "visible" }),
              );
              expect(yield* preparation.wasRequested).toBe(false);
              yield* browser.checkpoint(`${viewport.name}: organization entry panel`);
              yield* list.release;
              yield* loaded;
              yield* browser.checkpoint(`${viewport.name}: existing apps loaded`);
            }),
          );
        }

        yield* browser.use("Leave the remembered organization", (page) => page.goto("about:blank"));
        yield* browser.login(actors.owner);
        yield* browser.use("Make organization reads unavailable", (page) =>
          page.route("**/api/auth/organization/list", (route) => route.abort("failed")),
        );
        yield* browser.use("Open root during the read failure", (page) => page.goto("/"));
        yield* browser.use("The entry panel offers recovery", (page) =>
          page
            .getByRole("heading", { name: "Unable to load your organizations", exact: true })
            .waitFor({ state: "visible" }),
        );
        yield* browser.checkpoint("Organization read failure retains a clear entry page");
        yield* browser.use("Restore the real organization endpoint", (page) =>
          page.unroute("**/api/auth/organization/list"),
        );
        yield* browser.use("Retry organization selection", (page) =>
          page.getByRole("button", { name: "Try again", exact: true }).click(),
        );
        yield* loaded;
        yield* evidence.json("root-entry-result.json", {
          entryPath: "/",
          existingOrganizations: organizations.length,
          preparationRequested: false,
          rememberedDestinationLoadsBeforeOrganizationList: true,
          heldRequest: "/api/onboarding/prepare",
          organizationLoadingVerified: true,
          retryVerified: true,
          responseReplaced: false,
          colorScheme: "dark",
          timing: "Controlled request holds and capture pacing, not a latency benchmark",
        });
      }).pipe(Effect.provide(Onboarding.layer)),
    ),
  );
});
