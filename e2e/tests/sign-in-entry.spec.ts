import { expect, layer } from "@effect/vitest";
import { Effect } from "effect";
import { Actors } from "../support/actors.ts";
import { Browser } from "../support/browser.ts";
import { HostedLive, withCase } from "../support/case.ts";
import { Evidence } from "../support/evidence.ts";
import { holdOrganizationEntry, trackEntryNavigations } from "../support/organization-entry.ts";
import { scenarios } from "../test-plan.ts";

layer(HostedLive, { excludeTestServices: true })("Sign-in entry", (it) => {
  it.effect(scenarios.signInEntry.title, (context) =>
    withCase(
      context,
      Effect.gen(function* () {
        const actors = yield* Actors;
        const browser = yield* Browser;
        const evidence = yield* Evidence;
        const signInAsOwner = Effect.gen(function* () {
          yield* browser.use("Open the same test-account selector used in the preview", (page) =>
            page.getByRole("button", { name: "Open Executor dev tools", exact: true }).click(),
          );
          yield* browser.use("Choose Owner through the actual browser action", (page) =>
            page.getByRole("button", { name: "Sign in as Owner", exact: true }).click(),
          );
        });
        const paths = yield* trackEntryNavigations;
        const frames = yield* Effect.forEach(
          [
            { name: "Desktop", width: 864, height: 720 },
            { name: "Mobile", width: 390, height: 844 },
          ],
          (viewport) =>
            Effect.scoped(
              Effect.gen(function* () {
                yield* browser.use("Leave the previous document", (page) =>
                  page.goto("about:blank"),
                );
                yield* browser.use("Start with no cookies or organization history", (page) =>
                  page.context().clearCookies(),
                );
                yield* browser.use(`${viewport.name}: set the viewport`, (page) =>
                  page.setViewportSize({ width: viewport.width, height: viewport.height }),
                );
                yield* browser.use("Use the preview's dark appearance", (page) =>
                  page.emulateMedia({ colorScheme: "dark" }),
                );
                yield* browser.use("Open sign-in", (page) => page.goto("/login"));
                yield* browser.use("The real sign-in page is ready", (page) =>
                  page
                    .getByRole("heading", { name: "Sign in to Executor", exact: true })
                    .waitFor({ state: "visible" }),
                );
                const list = yield* holdOrganizationEntry;
                yield* signInAsOwner;
                yield* list.requested;
                yield* browser.checkpoint(
                  `${viewport.name}: signed-in organization lookup pending`,
                );
                expect(
                  yield* browser.use("The shared dashboard shell is already mounted", (page) =>
                    page.locator(".shell").count(),
                  ),
                ).toBe(1);
                yield* browser.use("Apps has its normal loading skeleton", (page) =>
                  page
                    .getByRole("status", { name: "Loading apps", exact: true })
                    .waitFor({ state: "visible" }),
                );
                expect(
                  yield* browser.use("Organization navigation has no guessed destination", (page) =>
                    page.locator('nav[aria-label="Main navigation"] a[href^="/org/"]').count(),
                  ),
                ).toBe(0);
                expect(
                  yield* browser.use("There is no separate sign-in spinner page", (page) =>
                    page.locator(".auth-pending").count(),
                  ),
                ).toBe(0);
                expect(
                  yield* browser.use("Destination lookup stays in sign-in completion", (page) =>
                    Promise.resolve(new URL(page.url()).pathname),
                  ),
                ).toBe("/login");
                const before = yield* browser.use("Capture the pending heading position", (page) =>
                  page.getByRole("heading", { name: "Apps", exact: true }).boundingBox(),
                );
                const searchBefore = yield* browser.use("Capture the search placeholder", (page) =>
                  page.getByLabel("Loading app search", { exact: true }).boundingBox(),
                );
                const cardBefore = yield* browser.use("Capture the first app placeholder", (page) =>
                  page
                    .getByRole("status", { name: "Loading apps", exact: true })
                    .locator(":scope > div")
                    .first()
                    .boundingBox(),
                );
                if (viewport.name === "Mobile") {
                  yield* browser.use("Open the phone's shared menu", (page) =>
                    page.getByRole("button", { name: "Menu", exact: true }).click(),
                  );
                  yield* browser.use("The phone menu shows the known user", (page) =>
                    page
                      .getByRole("dialog")
                      .getByText("Agent agent", { exact: true })
                      .waitFor({ state: "visible" }),
                  );
                  yield* browser.checkpoint(
                    "Mobile: signed-in menu while the organization is loading",
                  );
                  yield* browser.use("Close the phone menu", (page) =>
                    page.keyboard.press("Escape"),
                  );
                } else {
                  yield* browser.use("The sidebar shows the known user", (page) =>
                    page
                      .locator("aside")
                      .getByText("Agent agent", { exact: true })
                      .waitFor({ state: "visible" }),
                  );
                }
                yield* list.release;
                yield* browser.use("Sign-in opens the existing organization's Apps", (page) =>
                  page.waitForURL(`**/org/${actors.organization.slug}/apps`),
                );
                yield* browser.use("The real app cards replace the skeleton", (page) =>
                  page.locator(".app-card").first().waitFor({ state: "visible" }),
                );
                const after = yield* browser.use("Capture the loaded heading position", (page) =>
                  page.getByRole("heading", { name: /^Apps(?:\s*\d+)?$/ }).boundingBox(),
                );
                if (before === null || after === null)
                  throw new Error("Apps heading has no visible bounds");
                expect(Math.abs(before.x - after.x)).toBeLessThanOrEqual(2);
                expect(Math.abs(before.y - after.y)).toBeLessThanOrEqual(2);
                const searchAfter = yield* browser.use("Capture the real search field", (page) =>
                  page.getByRole("textbox", { name: "Search apps…", exact: true }).boundingBox(),
                );
                const cardAfter = yield* browser.use("Capture the first real app card", (page) =>
                  page.locator(".app-card").first().boundingBox(),
                );
                for (const [pending, loaded] of [
                  [searchBefore, searchAfter],
                  [cardBefore, cardAfter],
                ]) {
                  if (
                    pending === null ||
                    loaded === null ||
                    pending === undefined ||
                    loaded === undefined
                  )
                    throw new Error("App content has no visible bounds");
                  for (const key of ["x", "y", "width", "height"] as const)
                    expect(Math.abs(pending[key] - loaded[key])).toBeLessThanOrEqual(2);
                }
                yield* browser.checkpoint(`${viewport.name}: Apps after organization resolution`);
                return {
                  viewport: viewport.name,
                  before,
                  after,
                  searchBefore,
                  searchAfter,
                  cardBefore,
                  cardAfter,
                };
              }),
            ),
        );
        expect(paths).not.toContain("/");

        yield* browser.use("Leave the signed-in document", (page) => page.goto("about:blank"));
        yield* browser.use("Start without another saved session", (page) =>
          page.context().clearCookies(),
        );
        yield* browser.use("Open a fresh sign-in", (page) => page.goto("/login"));
        yield* browser.use("Fail the next organization read", (page) =>
          page.route("**/api/auth/organization/list", (route) => route.abort("failed"), {
            times: 1,
          }),
        );
        yield* signInAsOwner;
        yield* browser.use("Sign-in completion offers recovery", (page) =>
          page
            .getByRole("alert")
            .filter({ hasText: "Unable to load your organizations" })
            .waitFor({ state: "visible" }),
        );
        expect(
          yield* browser.use("Lookup failure keeps the dashboard shell", (page) =>
            page.locator(".shell").count(),
          ),
        ).toBe(1);
        yield* browser.checkpoint("Organization lookup error inside the dashboard shell");
        yield* browser.use("Retry the real destination lookup", (page) =>
          page.getByRole("button", { name: "Try again", exact: true }).click(),
        );
        yield* browser.use("Retry also opens Apps directly", (page) =>
          page.waitForURL(`**/org/${actors.organization.slug}/apps`),
        );
        expect(paths).not.toContain("/");
        yield* evidence.json("sign-in-entry.json", {
          frames,
          retryVerified: true,
          paths: [...paths],
          sessionInjected: false,
          rootDetour: false,
        });
        yield* browser.checkpoint("Sign-in destination recovers after a failed lookup");
      }),
    ),
  );
});
