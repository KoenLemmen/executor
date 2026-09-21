/** Product-owned MCP authority. No organization, browser session, or token is a grant. */
import { AppId, ToolName } from "@executor-js/sdk/core";
import { Match, Schema } from "effect";

/** Stable authorization identity shared by access tokens, refresh tokens, and continuations. */
export const GrantId = Schema.NonEmptyString.pipe(Schema.brand("McpGrantId"));
export type GrantId = typeof GrantId.Type;
/** Explicit app-wide permission includes future tools; a selected list never does. */
export const AppPermission = Schema.Struct({
  app: AppId,
  tools: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("all") }),
    Schema.Struct({ kind: Schema.Literal("selected"), names: Schema.Array(ToolName) }),
  ]),
});
/** Scope selects ordinary apps. All apps includes any Executor app the caller may use. */
export const GrantPolicy = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("tools"),
    apps: Schema.Array(AppPermission),
    approval: Schema.Literals(["browser", "client"]),
  }),
  Schema.Struct({ kind: Schema.Literal("all") }),
]);
export type GrantPolicy = typeof GrantPolicy.Type;
/** Revoked grants are absent from authentication, not converted to empty or unrestricted policies. */
export const ApprovalMode = Schema.Literals(["model", "native", "browser"]);
export type ApprovalMode = typeof ApprovalMode.Type;
/** The OAuth resource approved for this grant, preserved through refresh. */
export const GrantTarget = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("mcp"), mode: ApprovalMode }),
  Schema.Struct({ kind: Schema.Literal("api") }),
]);
export type GrantTarget = typeof GrantTarget.Type;
export const Grant = Schema.Struct({ id: GrantId, policy: GrantPolicy, target: GrantTarget });
export type Grant = typeof Grant.Type;
/** A current grant does not authorize this operation. No private resource details are exposed. */
export class GrantForbidden extends Schema.TaggedError<GrantForbidden>()("GrantForbidden", {}) {}

/** App visibility follows the grant; application identity never implies extra privileges. */
export const permitsApp = (policy: GrantPolicy, app: AppId) =>
  Match.value(policy).pipe(
    Match.when({ kind: "all" }, () => true),
    Match.when({ kind: "tools" }, ({ apps }) =>
      apps.some(
        (item) => item.app === app && (item.tools.kind === "all" || item.tools.names.length > 0),
      ),
    ),
    Match.exhaustive,
  );
/** Explicit names are exact matches, never regular expressions or wildcard patterns. */
export const permitsTool = (policy: GrantPolicy, app: AppId, tool: ToolName) =>
  permitsApp(policy, app) &&
  Match.value(policy).pipe(
    Match.when({ kind: "all" }, () => true),
    Match.when({ kind: "tools" }, ({ apps }) =>
      apps.some(
        (item) =>
          item.app === app &&
          Match.value(item.tools).pipe(
            Match.when({ kind: "all" }, () => true),
            Match.when({ kind: "selected" }, ({ names }) => names.includes(tool)),
            Match.exhaustive,
          ),
      ),
    ),
    Match.exhaustive,
  );
/** An issued MCP grant cannot change mode by changing the request URL. */
export const permitsDelivery = (grant: Grant, mode: ApprovalMode) =>
  grant.target.kind === "mcp" &&
  grant.target.mode === mode &&
  (grant.policy.kind === "all" || grant.policy.approval === "client" || mode === "browser");

/** Missing URL mode retains the original model-mode default; duplicates and unknown modes are invalid. */
export const requestedMcpMode = (url: URL): ApprovalMode | undefined => {
  const modes = url.searchParams.getAll("elicitation_mode");
  if (modes.length === 0) return "model";
  return modes.length === 1 && Schema.is(ApprovalMode)(modes[0]) ? modes[0] : undefined;
};
/** Canonical OAuth audience for each MCP mode. Query parameters are valid RFC 8707 resource URIs. */
export const mcpResource = (origin: string, mode: ApprovalMode) =>
  mode === "model" ? `${origin}/mcp` : `${origin}/mcp?elicitation_mode=${mode}`;
/** All mode-specific resources use the same OAuth issuer and ordinary MCP scope. */
export const mcpOAuthResources = (origin: string) =>
  (["model", "native", "browser"] as const).map((mode) => ({
    identifier: mcpResource(origin, mode),
    allowedScopes: ["mcp", "offline_access"],
  }));
/** Select exactly one known resource. Multi-resource consent must not combine approval modes. */
export const grantTarget = (
  origin: string,
  resources: readonly string[],
): GrantTarget | undefined => {
  if (resources.length !== 1) return undefined;
  const resource = resources[0];
  if (resource === `${origin}/api`) return { kind: "api" };
  for (const mode of ["model", "native", "browser"] as const)
    if (resource === mcpResource(origin, mode)) return { kind: "mcp", mode };
  return undefined;
};
/** Discovery and the authentication challenge carry the requested mode into standard OAuth. */
export const mcpResourceMetadataUrl = (origin: string, mode: ApprovalMode) =>
  `${origin}/.well-known/oauth-protected-resource/mcp?elicitation_mode=${mode}`;
