/** Session revalidation must not remove sign-in inputs that the visitor is editing. */
import { expect, layer } from "@effect/vitest";
import { Effect } from "effect";
import { Actors, password } from "../support/actors.ts";
import { Browser } from "../support/browser.ts";
import { HostedLive, withCase } from "../support/case.ts";
import { holdQuery, refreshVisiblePage } from "../support/query-transition.ts";
import { scenarios } from "../test-plan.ts";

const retainedDraft = (field: "Password" | "Sign-in code", value: string) =>
  Effect.gen(function* () {
    const browser = yield* Browser;
    const assertDraft = () =>
      Effect.gen(function* () {
        expect(
          yield* browser.use("Email input stays mounted", (page) =>
            page.getByLabel("Email", { exact: true }).count(),
          ),
        ).toBe(1);
        expect(
          yield* browser.use("Email draft is retained", (page) =>
            page.getByLabel("Email", { exact: true }).inputValue(),
          ),
        ).toBe("focus@example.test");
        expect(
          yield* browser.use(`${field} draft is retained`, (page) =>
            page.getByLabel(field, { exact: true }).inputValue(),
          ),
        ).toBe(value);
      });
    yield* Effect.scoped(
      Effect.gen(function* () {
        const held = yield* holdQuery(["/api/auth/get-session"], "continue");
        yield* refreshVisiblePage;
        yield* held.requested;
        yield* assertDraft();
        yield* browser.checkpoint("Sign-in draft remains while session check is pending");
        yield* held.release;
      }),
    );
    yield* assertDraft();
    yield* Effect.scoped(
      Effect.gen(function* () {
        const failed = yield* holdQuery(["/api/auth/get-session"], "fail");
        yield* refreshVisiblePage;
        yield* failed.requested;
        yield* failed.release;
        yield* browser.use("Session failure is shown beside the draft", (page) =>
          page
            .getByText("Unable to check your session.", { exact: true })
            .waitFor({ state: "visible" }),
        );
        yield* assertDraft();
        yield* browser.checkpoint("Sign-in draft remains after session-check failure");
      }),
    );
    yield* browser.use("Retry the session check", (page) =>
      page.getByRole("button", { name: "Try again", exact: true }).click(),
    );
    yield* browser.use("Session check recovers", (page) =>
      page.getByText("Unable to check your session.", { exact: true }).waitFor({ state: "hidden" }),
    );
    yield* assertDraft();
  });

layer(HostedLive, { excludeTestServices: true })("Login refresh", (it) => {
  it.effect(scenarios.passwordRefresh.title, (context) =>
    withCase(
      context,
      Effect.gen(function* () {
        const browser = yield* Browser,
          actors = yield* Actors;
        const destination = `/org/${actors.organization.slug}/groups`;
        yield* browser.use("Open sign-in without a session", (page) =>
          page.goto(`/login?redirect=${encodeURIComponent(destination)}`),
        );
        yield* browser.use("Type email", (page) =>
          page.getByLabel("Email", { exact: true }).fill("focus@example.test"),
        );
        yield* browser.use("Type password", (page) =>
          page.getByLabel("Password", { exact: true }).fill(password),
        );
        yield* retainedDraft("Password", password);
        yield* browser.login(actors.owner);
        yield* refreshVisiblePage;
        yield* browser.use("A newly authenticated session still redirects", (page) =>
          page.waitForURL((url) => url.pathname === destination),
        );
        yield* browser.checkpoint("Verified session redirects to the original destination");
      }),
    ),
  );
  it.effect(scenarios.emailCodeRefresh.title, (context) =>
    withCase(
      context,
      Effect.gen(function* () {
        const browser = yield* Browser;
        yield* browser.use("Open Cloud sign-in without a session", (page) => page.goto("/login"));
        yield* browser.use("Type email", (page) =>
          page.getByLabel("Email", { exact: true }).fill("focus@example.test"),
        );
        yield* browser.use("Request a code from the test email service", (page) =>
          page.getByRole("button", { name: "Email me a code", exact: true }).click(),
        );
        yield* browser.use("Start typing the code", (page) =>
          page.getByLabel("Sign-in code", { exact: true }).fill("123456"),
        );
        yield* retainedDraft("Sign-in code", "123456");
      }),
    ),
  );
});
