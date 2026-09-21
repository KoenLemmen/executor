/** Apply one grant at every shared MCP operation; hosts retain their existing resource checks. */
import type { McpBackend } from "@executor-js/mcp";
import { ElicitationFailed, type AppId } from "@executor-js/sdk/core";
import { Effect, Match } from "effect";
import { GrantForbidden, permitsApp, permitsTool, type Grant } from "../contracts/grant.ts";

/** Re-read authority per operation, including while an execution resumes within one HTTP call. */
export const restrictMcpBackend = <E extends Error, G extends Error>(
  backend: McpBackend<E>,
  current: Effect.Effect<Grant, G>,
): McpBackend<E | G | GrantForbidden> => {
  const authority = current;
  const check = (app: AppId, tool?: Parameters<typeof permitsTool>[2]) =>
    authority.pipe(
      Effect.flatMap((grant) =>
        (tool === undefined ? permitsApp(grant.policy, app) : permitsTool(grant.policy, app, tool))
          ? Effect.void
          : Effect.fail(new GrantForbidden()),
      ),
    );
  return {
    listSkills: (input) => check(input.app).pipe(Effect.andThen(() => backend.listSkills(input))),
    readSkill: (input) => check(input.app).pipe(Effect.andThen(() => backend.readSkill(input))),
    listApps: (input) =>
      Effect.gen(function* () {
        const grant = yield* authority;
        const ids = Match.value(grant.policy).pipe(
          Match.when({ kind: "all" }, () => input?.ids),
          Match.when({ kind: "tools" }, ({ apps }) => {
            const requested = input?.ids === undefined ? undefined : new Set(input.ids);
            return [
              ...new Set(
                apps
                  .filter(
                    ({ app, tools }) =>
                      (tools.kind === "all" || tools.names.length > 0) &&
                      (requested === undefined || requested.has(app)),
                  )
                  .map(({ app }) => app),
              ),
            ];
          }),
          Match.exhaustive,
        );
        return yield* backend.listApps({ ids });
      }),
    listTools: (input) =>
      Effect.gen(function* () {
        yield* check(input.app);
        const page = yield* backend.listTools(input);
        const grant = yield* authority;
        return {
          ...page,
          items: page.items.filter((tool) => permitsTool(grant.policy, input.app, tool.name)),
        };
      }),
    callTool: (input, options) =>
      check(input.app, input.tool).pipe(Effect.andThen(() => backend.callTool(input, options))),
    resumeInvocation: (request, response, options) =>
      check(request.invocation.app, request.invocation.tool).pipe(
        Effect.andThen(() => backend.resumeInvocation(request, response, options)),
      ),
    authorizeElicitation: (input) =>
      check(input.app, input.tool).pipe(
        Effect.mapError(() => new ElicitationFailed({ reason: "forbidden" })),
        Effect.andThen(() => backend.authorizeElicitation(input)),
      ),
  };
};
