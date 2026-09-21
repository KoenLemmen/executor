/** A target's applicability is explicit. Missing evidence never implies N/A. */
import { Schema } from "effect";
import type { Target } from "./report-model.ts";

/** Scheduled tests need a real result; other dispositions explain why none is expected. */
export const TargetPlan = Schema.Union([
  Schema.Struct({ status: Schema.Literal("scheduled") }),
  Schema.Struct({ status: Schema.Literal("not-applicable"), reason: Schema.NonEmptyString }),
  Schema.Struct({ status: Schema.Literal("not-run"), reason: Schema.NonEmptyString }),
]);
/** Snapshot this plan in a report so later configuration changes cannot rewrite its meaning. */
export const TestPlan = Schema.Struct({
  file: Schema.String,
  title: Schema.String,
  targets: Schema.Struct({ "self-host": TargetPlan, local: TargetPlan, cloud: TargetPlan }),
});
const scheduled = { status: "scheduled" } as const;
const na = (reason: string) => ({ status: "not-applicable", reason }) as const;
const cloudOnboarding = {
  cloud: scheduled,
  "self-host": na(
    "Self-host has instance setup and password/SSO admission instead of Cloud onboarding.",
  ),
  local: na("Local uses device pairing instead of Cloud account onboarding."),
};

/** Scenario names and applicability used by both test declarations and test selection. */
export const scenarios = {
  lastOrganization: {
    file: "last-organization.spec.ts",
    title: "Last active organization survives entry and rename while stale destinations recover",
    targets: cloudOnboarding,
  },
  rootEntryLoading: {
    file: "root-entry-loading.spec.ts",
    title: "Signed-in root opens existing organizations without first-team preparation",
    targets: cloudOnboarding,
  },
  localQueryState: {
    file: "local-query-state.spec.ts",
    title: "Local forms retain drafts through live read failures and reset for another resource",
    targets: {
      local: scheduled,
      "self-host": na("This journey checks local storage subscriptions and pairing."),
      cloud: na("This journey checks local storage subscriptions and pairing."),
    },
  },
  queryRefresh: {
    file: "query-refresh.spec.ts",
    title: "Dashboard refresh preserves drafts through failed reads and recovery",
    targets: {
      "self-host": scheduled,
      cloud: scheduled,
      local: na("This journey checks hosted query refresh after organization identity resolution."),
    },
  },
  membersRefresh: {
    file: "query-refresh.spec.ts",
    title: "Dashboard members retain their rows and invitation draft through refresh errors",
    targets: {
      "self-host": scheduled,
      cloud: scheduled,
      local: na("Local has no hosted organization membership."),
    },
  },
  sessionHint: {
    file: "session-hint.spec.ts",
    title: "Session hints paint early without granting access and clear on sign-out or expiry",
    targets: {
      "self-host": scheduled,
      cloud: scheduled,
      local: na("Local uses pairing rather than hosted session cookies."),
    },
  },
  localAppDetailLoading: {
    file: "local-app-detail-loading.spec.ts",
    title: "Local app navigation keeps a stable loading panel through live reads",
    targets: {
      local: scheduled,
      "self-host": na("This journey checks local pairing and live app reads."),
      cloud: na("This journey checks local pairing and live app reads."),
    },
  },
  appDetailLoading: {
    file: "app-detail-loading.spec.ts",
    title: "App detail navigation preserves its frame while metadata and tools load",
    targets: {
      "self-host": scheduled,
      cloud: scheduled,
      local: na("This journey checks hosted app metadata requests."),
    },
  },
  dashboardLoading: {
    file: "dashboard-loading.spec.ts",
    title: "Dashboard loading shows content skeletons without auth or organization gates",
    targets: {
      "self-host": scheduled,
      cloud: scheduled,
      local: na("This journey checks hosted session entry and organization references."),
    },
  },
  appUi: {
    file: "app-ui.spec.ts",
    title: "private app bookmarks authenticate and execute through the hosted runtime",
    targets: {
      "self-host": scheduled,
      cloud: scheduled,
      local: na("This scenario uses hosted Better Auth and organization routes."),
    },
  },
  executorKeyAccount: {
    file: "executor-key-account.spec.ts",
    title: "Executor upserts and selects the managed user API key account",
    targets: {
      "self-host": scheduled,
      cloud: scheduled,
      local: na("Local uses its configured instance API key."),
    },
  },
  userApiKey: {
    file: "user-api-key.spec.ts",
    title: "User API keys are stable, private and independent of dashboard sessions",
    targets: {
      "self-host": scheduled,
      cloud: {
        status: "not-run",
        reason: "This session lifecycle scenario uses self-host password login.",
      },
      local: na("Local uses its configured instance API key."),
    },
  },
  appContext: {
    file: "app-context.spec.ts",
    title: "standalone app handlers receive fresh accounts and scoped storage",
    targets: {
      "self-host": scheduled,
      cloud: scheduled,
      local: na("This scenario uses hosted account and webhook management routes."),
    },
  },
  onboardingGoogle: {
    file: "cloud-onboarding.spec.ts",
    title: "Cloud onboarding with Google shows company preparation before team confirmation",
    targets: cloudOnboarding,
  },
  onboardingGithub: {
    file: "cloud-onboarding.spec.ts",
    title: "Cloud onboarding with GitHub retains edited team details through a failed confirmation",
    targets: cloudOnboarding,
  },
  onboardingEmail: {
    file: "cloud-onboarding.spec.ts",
    title: "Cloud onboarding with email registers a passkey and uses it for returning sign-in",
    targets: cloudOnboarding,
  },
  onboardingSkip: {
    file: "cloud-onboarding.spec.ts",
    title:
      "Cloud onboarding can skip a passkey and returning email sign-in keeps the existing team",
    targets: cloudOnboarding,
  },
  localSkills: {
    file: "local-skills.spec.ts",
    title: "local MCP skills follow configured copies and deployment versions",
    targets: {
      local: scheduled,
      "self-host": na(
        "Local bearer access is covered here; hosted OAuth skills use the hosted scenario.",
      ),
      cloud: na(
        "Local bearer access is covered here; hosted OAuth skills use the hosted scenario.",
      ),
    },
  },
  appSkills: {
    file: "app-skills.spec.ts",
    title: "app skills remain static, authorized and pinned across deployments",
    targets: {
      "self-host": scheduled,
      cloud: scheduled,
      local: na("This scenario tests hosted membership; local skills are covered through MCP."),
    },
  },
  mcp: {
    file: "claude-mcp.spec.ts",
    title: "Claude Code connects through /mcp, browser authentication and a real tool call",
    targets: {
      "self-host": scheduled,
      cloud: scheduled,
      local: na("This scenario tests hosted organization consent, which Local does not have."),
    },
  },
  mcpProtocol: {
    file: "mcp-server.spec.ts",
    title: "MCP OAuth grants support discovery, execution, refresh and revocation",
    targets: {
      "self-host": scheduled,
      cloud: scheduled,
      local: na("This scenario tests hosted organization consent, which Local does not have."),
    },
  },
  organizationRemoval: {
    file: "organization-removal.spec.ts",
    title: "Owners delete an organization with every app, account and membership it holds",
    targets: {
      cloud: scheduled,
      "self-host": na(
        "Self-host has a single instance organization and does not expose organization deletion.",
      ),
      local: na("Local has no hosted organizations."),
    },
  },
  hosted: {
    file: "hosted-shared.spec.ts",
    title: "hosted roles, account connection, discovery and invocation agree",
    targets: {
      "self-host": scheduled,
      cloud: scheduled,
      local: na("Local has no hosted organizations or membership roles."),
    },
  },
  remoteMcp: {
    file: "hosted-shared.spec.ts",
    title: "a public remote MCP server imports, discovers tools and calls one end to end",
    targets: {
      "self-host": scheduled,
      cloud: scheduled,
      local: na("This scenario tests the hosted custom-import endpoint and organization roles."),
    },
  },
  password: {
    file: "hosted.spec.ts",
    title: "self-host password login opens the owner and member dashboards",
    targets: {
      "self-host": scheduled,
      cloud: na(
        "Cloud uses email codes, passkeys and social sign-in instead of self-host passwords.",
      ),
      local: na("Local uses device pairing instead of password login."),
    },
  },
  scale: {
    file: "hosted.spec.ts",
    title: "concurrent owners and admins save every account in a large inventory",
    targets: {
      "self-host": scheduled,
      cloud: {
        status: "not-run",
        reason: "Requires dedicated cloud load capacity; shared test-stage databases are excluded.",
      },
      local: na("This workload tests hosted organization accounts and administrator roles."),
    },
  },
  telemetry: {
    file: "hosted.spec.ts",
    title: "real requests reach Motel with correlated server spans",
    targets: {
      "self-host": scheduled,
      cloud: na("Cloud exports to Axiom; this test checks the self-host Motel collector."),
      local: na("This test checks hosted organization routes and self-host service spans."),
    },
  },
  local: {
    file: "local.spec.ts",
    title: "local pairing opens the dashboard and the one-use link cannot be replayed",
    targets: {
      local: scheduled,
      "self-host": na("Self-host uses hosted sign-in rather than local device pairing."),
      cloud: na("Cloud uses hosted sign-in rather than local device pairing."),
    },
  },
  cloud: {
    file: "cloud.spec.ts",
    title: "cloud endpoint is healthy and protects the signed-out viewer",
    targets: {
      cloud: scheduled,
      "self-host": na("This test checks Cloud's email-code sign-in UI."),
      local: na("This test checks Cloud's hosted sign-in and viewer routes."),
    },
  },
} as const satisfies Record<string, typeof TestPlan.Type>;

/** Select only explicitly scheduled files for a target; cloud scale stays disabled. */
export const filesForTarget = (target: typeof Target.Type, suite: "all" | "hosted") => [
  ...new Set(
    (suite === "hosted"
      ? [scenarios.hosted, scenarios.mcp, scenarios.mcpProtocol, scenarios.appSkills]
      : Object.values(scenarios)
    )
      .filter((scenario) => scenario.targets[target].status === "scheduled")
      .map((scenario) => `e2e/tests/${scenario.file}`),
  ),
];
