/** Keep product permissions and execution admission outside the reusable workflow SDK. */
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { HostedApi } from "../contracts/api.ts";
import { HostedExecutor } from "../contracts/executor.ts";
import { CurrentOrganization } from "../contracts/organization.ts";
import { ExecutionAdmission } from "../contracts/execution-admission.ts";
import { adminOwner, currentOwner, selectedApp } from "./access.ts";

/** Run reads check current membership; writes require current administrator authority. */
export const hostedWorkflowHandlers = HttpApiBuilder.group(HostedApi, "workflows", (handlers) =>
  handlers
    .handle("definitions", ({ params }) =>
      Effect.gen(function* () {
        const owner = yield* currentOwner,
          executor = yield* Effect.flatten(HostedExecutor);
        yield* selectedApp(executor, owner, params.app);
        return yield* executor.apps.workflows.list(params);
      }),
    )
    .handle("start", ({ params, payload }) =>
      Effect.gen(function* () {
        const owner = yield* adminOwner,
          executor = yield* Effect.flatten(HostedExecutor);
        yield* selectedApp(executor, owner, params.app);
        yield* (yield* ExecutionAdmission)((yield* CurrentOrganization).organization);
        return yield* executor.apps.workflowRuns.start({ ...params, ...payload });
      }),
    )
    .handle("get", ({ params }) =>
      Effect.gen(function* () {
        const owner = yield* currentOwner,
          executor = yield* Effect.flatten(HostedExecutor);
        yield* executor.apps.get({ owner, app: params.app });
        return yield* executor.apps.workflowRuns.get(params);
      }),
    )
    .handle("list", ({ params, query }) =>
      Effect.gen(function* () {
        const owner = yield* currentOwner,
          executor = yield* Effect.flatten(HostedExecutor);
        yield* executor.apps.get({ owner, app: params.app });
        return yield* executor.apps.workflowRuns.list({ ...params, ...query });
      }),
    )
    .handle("terminate", ({ params }) =>
      Effect.gen(function* () {
        const owner = yield* adminOwner,
          executor = yield* Effect.flatten(HostedExecutor);
        yield* executor.apps.get({ owner, app: params.app });
        return yield* executor.apps.workflowRuns.terminate(params);
      }),
    ),
);
