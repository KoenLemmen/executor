/** The same dashboard controls and browser approval, driven through the hosted product. */
import { expect, layer } from "@effect/vitest";
import { Effect, Schedule, Schema } from "effect";
import { randomUUID } from "node:crypto";
import { Actors } from "../support/actors.ts";
import { Api, body } from "../support/api.ts";
import { Browser } from "../support/browser.ts";
import { HostedLive, withCase } from "../support/case.ts";
import { scenarios } from "../test-plan.ts";

class Pending extends Schema.TaggedError<Pending>()("Pending", {}) {}
const source = `import { defineApp, mutation, object, interval } from "apps";
import { always } from "apps/operations/approval";
const send = mutation({ input: object({}), approval: always() }, async () => ({ done: true }));
export default defineApp({ accounts: {} }, async () => ({ name: "Hosted browser schedules", mutations: { send }, schedules: { digest: interval({ hours: 1 }, send, {}) } }));`;
layer(HostedLive, { excludeTestServices: true })("Hosted schedule dashboard", (it) => {
  it.effect(scenarios.hostedScheduleBrowser.title, (context) =>
    withCase(
      context,
      Effect.gen(function* () {
        const api = yield* Api,
          browser = yield* Browser,
          actors = yield* Actors;
        const prefix = `/api/organizations/${actors.organization.id}`;
        const deployed = yield* api.request(actors.owner, "POST", `${prefix}/apps/deploy`, {
          name: `Browser schedules ${randomUUID().slice(0, 8)}`,
          files: [{ path: "index.ts", content: source }],
        });
        expect(deployed.status).toBe(200);
        const app = yield* body(Schema.Struct({ id: Schema.String }), deployed);
        yield* Effect.addFinalizer(() =>
          api.request(actors.owner, "DELETE", `${prefix}/apps/${app.id}`).pipe(Effect.orDie),
        );
        const view = `/org/${actors.organization.slug}/apps/${app.id}?view=schedules`;
        yield* browser.login(actors.owner);
        yield* browser.use("Open schedule controls", (page) => page.goto(view));
        yield* browser.use("Choose approval mode", (page) =>
          page.getByRole("combobox", { name: "Approvals for digest" }).click(),
        );
        yield* browser.use("Use browser approvals", (page) =>
          page.getByRole("option", { name: "Browser approvals" }).click(),
        );
        yield* browser.use("Enable the schedule", (page) =>
          page.getByRole("button", { name: "Enable", exact: true }).click(),
        );
        yield* browser.use("Wait for enabled controls", (page) =>
          page.getByRole("button", { name: "Pause", exact: true }).waitFor(),
        );
        yield* browser.checkpoint("01 Hosted schedule controls");
        yield* browser.use("Request a run", (page) =>
          page.getByRole("button", { name: "Run now", exact: true }).click(),
        );
        yield* browser.use("Open approvals", (page) =>
          page.getByRole("link", { name: "Approvals", exact: true }).click(),
        );
        yield* browser.use("Reload the approval queue", (page) => page.reload());
        yield* browser.use("Wait for pending approval", (page) =>
          page.getByRole("link", { name: "Review", exact: true }).waitFor(),
        );
        yield* browser.checkpoint("02 Hosted approvals list");
        yield* browser.use("Review the pending run", (page) =>
          page.getByRole("link", { name: "Review", exact: true }).click(),
        );
        yield* browser.use("Reload the bookmarked approval", (page) => page.reload());
        yield* browser.use("Wait for approval form", (page) =>
          page.getByRole("button", { name: "Approve", exact: true }).waitFor(),
        );
        yield* browser.checkpoint("03 Review scheduled run");
        yield* browser.use("Approve the mutation", (page) =>
          page.getByRole("button", { name: "Approve", exact: true }).click(),
        );
        yield* browser.use("Observe acknowledgement", (page) =>
          page
            .getByText("Your response was saved. Approved runs continue in the background.", {
              exact: true,
            })
            .waitFor(),
        );
        yield* browser.checkpoint("04 Approval saved");
        yield* api.request(actors.owner, "GET", `${prefix}/scheduled-runs?app=${app.id}`).pipe(
          Effect.flatMap((response) =>
            body(Schema.Array(Schema.Struct({ status: Schema.String })), response),
          ),
          Effect.flatMap((runs) =>
            runs.some((run) => run.status === "succeeded")
              ? Effect.void
              : Effect.fail(new Pending()),
          ),
          Effect.retry({
            while: (error) => error instanceof Pending,
            schedule: Schedule.spaced("250 millis"),
          }),
          Effect.timeout("30 seconds"),
        );
        yield* browser.use("Reopen schedule controls", (page) => page.goto(view));
        yield* browser.use("Pause the schedule", (page) =>
          page.getByRole("button", { name: "Pause", exact: true }).click(),
        );
        yield* browser.use("Observe paused state", (page) =>
          page.getByRole("button", { name: "Enable", exact: true }).waitFor(),
        );
        expect(
          yield* body(
            Schema.Array(Schema.Struct({ enabled: Schema.Boolean })),
            yield* api.request(actors.owner, "GET", `${prefix}/apps/${app.id}/schedules`),
          ),
        ).toEqual([{ enabled: false }]);
      }),
    ),
  );
});
