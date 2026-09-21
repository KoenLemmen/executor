/** Hosted catalog and execution policy for the shared MCP engine; no HTTP transport or credentials. */
import type { McpBackend } from "@executor-js/mcp";
import { ElicitationFailed, type ToolInvocationOptions } from "@executor-js/sdk/core";
import { Context, Effect } from "effect";
import { adminOwner, selectedApp } from "./access.ts";
import { OrganizationDefaults } from "../contracts/organization-defaults.ts";
import { HostedExecutor } from "../contracts/executor.ts";
import { CurrentOrganization } from "../contracts/organization.ts";
import { listTools } from "./tools.ts";
import { listAppSkills, readAppSkill } from "./skills.ts";

/**
 * Bind one request's verified membership and lazy SDK. The host must authenticate
 * and check membership before supplying CurrentOrganization, on every request.
 * Do not retain this adapter in an MCP session or a process-global layer.
 */
export const hostedMcpBackend = Effect.gen(function* () {
  const organization = yield* CurrentOrganization;
  const sdk = yield* HostedExecutor;
  const initialize = yield* OrganizationDefaults;
  const context = Context.make(CurrentOrganization, organization).pipe(
    Context.add(HostedExecutor, sdk),
  );
  const backend = {
    listSkills: (input) => listAppSkills(input).pipe(Effect.provideContext(context)),
    readSkill: (input) => readAppSkill(input).pipe(Effect.provideContext(context)),
    authorizeElicitation: (input) =>
      Effect.gen(function* () {
        const owner = yield* adminOwner;
        const executor = yield* sdk;
        yield* selectedApp(executor, owner, input.app);
      }).pipe(
        Effect.provideContext(context),
        Effect.catchTags({
          OrganizationForbidden: () => Effect.fail(new ElicitationFailed({ reason: "forbidden" })),
          AppNotFound: () => Effect.fail(new ElicitationFailed({ reason: "forbidden" })),
          AccountNotFound: () => Effect.fail(new ElicitationFailed({ reason: "forbidden" })),
          StorageError: () => Effect.fail(new ElicitationFailed({ reason: "transport" })),
        }),
      ),
    listApps: (input = {}) =>
      initialize(organization.organization).pipe(
        Effect.andThen(
          Effect.flatMap(sdk, (executor) =>
            executor.apps.list({ ...input, owner: organization.owner }),
          ),
        ),
      ),
    listTools: (input) => listTools(input).pipe(Effect.provideContext(context)),
    callTool: (input, options?: ToolInvocationOptions) =>
      Effect.gen(function* () {
        const owner = yield* adminOwner;
        const executor = yield* sdk;
        yield* selectedApp(executor, owner, input.app);
        return yield* executor.tools.call(input, options);
      }).pipe(Effect.provideContext(context)),
    resumeInvocation: (request, response, options?: ToolInvocationOptions) =>
      Effect.gen(function* () {
        const owner = yield* adminOwner;
        const executor = yield* sdk;
        yield* selectedApp(executor, owner, request.invocation.app);
        return yield* executor.tools.resume(
          { requestId: request.requestId, owner, response },
          options,
        );
      }).pipe(Effect.provideContext(context)),
  } satisfies McpBackend<Error>;
  return backend;
});
