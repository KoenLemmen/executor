import { layer } from "@effect/vitest";
import { Effect } from "effect";
import { Browser } from "../support/browser.ts";
import { HostedLive, withCase } from "../support/case.ts";
import { openSignedOutLogin, retainedDraft } from "../support/sign-in-refresh.ts";
import { scenarios } from "../test-plan.ts";

layer(HostedLive, { excludeTestServices: true })("Email code refresh", (it) => {
  it.effect(scenarios.emailCodeRefresh.title, (context) =>
    withCase(
      context,
      Effect.gen(function* () {
        const browser = yield* Browser;
        yield* browser.omitNetworkTrace;
        yield* openSignedOutLogin("/login");
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
