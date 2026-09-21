/**
 * CI configuration plane: repository settings, deployment environments, the CI Cloudflare
 * token, and the protected-branch ruleset. Owner and repository are configuration, so the
 * same stack can later target the original `usefulsoftwareco/executor` repository.
 */
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as GitHub from "alchemy/GitHub";
import { retain } from "alchemy/RemovalPolicy";
import { Config, Effect, Layer } from "effect";

/**
 * Secrets seeded from the environment. `op run --env-file=.env.ci.op` resolves the 1Password
 * references; the resolved values never reach disk, state, or stack outputs.
 *
 * GitHub Actions rejects secret and variable names that start with `GITHUB_`, so the login
 * client uses the `AUTH_GITHUB_` prefix. Workflows map it back to the variable the cloud
 * stack reads: `GITHUB_CLIENT_ID: ${{ secrets.AUTH_GITHUB_CLIENT_ID }}`.
 */
const productionSecrets = [
  "AUTH_GITHUB_CLIENT_ID",
  "AUTH_GITHUB_CLIENT_SECRET",
  "AUTUMN_EMULATOR_URL",
  "AUTUMN_SECRET_KEY",
  "AXIOM_TOKEN",
  "BETTER_AUTH_SECRET",
  "CONTEXT_DEV_API_KEY",
  "DATABASE_URL",
  "EXECUTOR_ENCRYPTION_KEY",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "OAUTH_PROXY_SECRET",
  "PLANETSCALE_API_TOKEN",
  "PLANETSCALE_API_TOKEN_ID",
  "POSTHOG_PERSONAL_API_KEY",
  "SENTRY_AUTH_TOKEN",
] as const;

/** Non-sensitive deployment settings. They are readable in logs and pull requests. */
const productionVariables = [
  "AUTH_EMAIL_DOMAIN",
  "AUTH_EMAIL_PROVISION_SUBDOMAIN",
  "AUTH_TRUSTED_ORIGINS",
  "AXIOM_ORG_ID",
  "BETTER_AUTH_URL",
  "BILLING_MODE",
  "CLOUDFLARE_ZONE_ID",
  "CLOUD_DATABASE_CONNECTION_LIMIT",
  "CLOUD_PLACEMENT_REGION",
  "EXECUTOR_APP_UI_BASE_URL",
  "OAUTH_PROXY_PRODUCTION_URL",
  "PLANETSCALE_CLUSTER_SIZE",
  "PLANETSCALE_DATABASE_NAME",
  "PLANETSCALE_ORGANIZATION",
  "PLANETSCALE_REGION",
  "POSTHOG_ENABLED",
  "POSTHOG_HOST",
  "POSTHOG_INGEST_HOST",
  "POSTHOG_ORGANIZATION_ID",
  "SENTRY_ENABLED",
  "SENTRY_ORG",
  "SENTRY_TEAM",
  "SENTRY_URL",
] as const;

/**
 * Publish credentials. `NPM_TOKEN` is deliberately absent: npm trusted publishing gives the
 * release workflow a short-lived OIDC credential and provenance, and needs no stored token.
 * See notes/ci.md for the one-line change if a scoped token is chosen instead.
 */
const releaseSecrets = [
  "APPLE_API_ISSUER",
  "APPLE_API_KEY",
  "APPLE_API_KEY_ID",
  "CSC_KEY_PASSWORD",
  "CSC_LINK",
  "RELEASE_PAT",
] as const;

/**
 * Required status checks on `main`. These are the contexts reported by `ci.yml` calling
 * `checks.yml` (PR #246). `CI_RULESET_ENFORCEMENT` defaults to `evaluate` (log only) until
 * that workflow is on `main`; set it to `active` afterwards.
 */
const requiredStatusChecks = [
  "checks / check",
  "checks / e2e-local",
  "checks / e2e-self-host",
  "checks / e2e-cloud",
] as const;

export default Alchemy.Stack(
  "executor-next-ci",
  {
    providers: Layer.mergeAll(GitHub.providers(), Cloudflare.providers()),
    // One configured stage (`ci`) with local state, like the other configured stacks.
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const owner = yield* Config.NonEmptyString("GITHUB_OWNER");
    const name = yield* Config.NonEmptyString("GITHUB_REPOSITORY_NAME");
    const accountId = yield* Config.NonEmptyString("CLOUDFLARE_ACCOUNT_ID");
    const zoneId = yield* Config.NonEmptyString("CLOUDFLARE_ZONE_ID");
    const enforcement = yield* Config.Literals(
      ["evaluate", "active", "disabled"],
      "CI_RULESET_ENFORCEMENT",
    ).pipe(Config.withDefault("evaluate" as const));

    // The repository already exists. Alchemy observes it and converges these settings only;
    // every property it does not declare keeps its current value.
    const repository = yield* GitHub.Repository("Repository", {
      owner,
      name,
      description: "Executor SDK, app framework, and local product",
      visibility: "private",
      defaultBranch: "main",
      hasIssues: true,
      hasProjects: true,
      hasWiki: false,
      hasDiscussions: false,
      // Squash is the only merge strategy: one commit per pull request on main.
      allowSquashMerge: true,
      allowMergeCommit: false,
      allowRebaseMerge: false,
      allowAutoMerge: false,
      deleteBranchOnMerge: true,
    }).pipe(retain());

    const target = { owner, repository: name };

    const production = yield* GitHub.Environment("Production", {
      ...target,
      name: "production",
      deploymentBranchPolicy: { customBranchPolicies: ["main"] },
    }).pipe(retain());

    const release = yield* GitHub.Environment("Release", {
      ...target,
      name: "release",
      deploymentBranchPolicy: { customBranchPolicies: ["main"] },
    }).pipe(retain());

    /**
     * The CI deployment token. Cloudflare returns its value once, on creation, so Alchemy is
     * the only place that can copy it into the GitHub secret. Cloudflare's API names the
     * "Edit" permission groups "Write". Zone permissions on an account-owned token nest
     * under the account resource.
     */
    const deployToken = yield* Cloudflare.ApiToken.AccountApiToken("DeployToken", {
      name: `executor-next-ci-${name}`,
      accountId,
      policies: [
        {
          effect: "allow",
          permissionGroups: [
            "Workers Scripts Write",
            "Workers R2 Storage Write",
            "Hyperdrive Write",
            "Account Settings Read",
          ],
          resources: { [`com.cloudflare.api.account.${accountId}`]: "*" },
        },
        {
          effect: "allow",
          permissionGroups: ["SSL and Certificates Write", "Workers Routes Write"],
          resources: {
            [`com.cloudflare.api.account.${accountId}`]: {
              [`com.cloudflare.api.account.zone.${zoneId}`]: "*",
            },
          },
        },
      ],
    }).pipe(retain());

    // Repository scope: pull request workflows deploy test stages with the same credential.
    yield* GitHub.Secret("CloudflareApiToken", {
      ...target,
      name: "CLOUDFLARE_API_TOKEN",
      value: deployToken.value,
    }).pipe(retain());
    yield* GitHub.Variable("CloudflareAccountId", {
      ...target,
      name: "CLOUDFLARE_ACCOUNT_ID",
      value: accountId,
    }).pipe(retain());

    yield* Effect.forEach(productionSecrets, (secret) =>
      Config.Redacted(secret).pipe(
        Effect.flatMap((value) =>
          GitHub.Secret(`production-${secret}`, {
            ...target,
            name: secret,
            value,
            environment: production,
          }).pipe(retain()),
        ),
      ),
    );

    yield* Effect.forEach(productionVariables, (variable) =>
      Config.NonEmptyString(variable).pipe(
        Effect.flatMap((value) =>
          GitHub.Variable(`production-${variable}`, {
            ...target,
            name: variable,
            value,
            environment: production,
          }).pipe(retain()),
        ),
      ),
    );

    yield* Effect.forEach(releaseSecrets, (secret) =>
      Config.Redacted(secret).pipe(
        Effect.flatMap((value) =>
          GitHub.Secret(`release-${secret}`, {
            ...target,
            name: secret,
            value,
            environment: release,
          }).pipe(retain()),
        ),
      ),
    );

    const ruleset = yield* GitHub.Ruleset("Main", {
      ...target,
      name: "main",
      enforcement,
      target: "branch",
      conditions: { include: ["refs/heads/main"] },
      // Administrators keep direct access while the workflow names are still settling.
      bypassActors: [{ actorType: "RepositoryRole", actorId: 5, bypassMode: "always" }],
      rules: {
        deletion: true,
        nonFastForward: true,
        requiredStatusChecks: {
          checks: requiredStatusChecks.map((context) => ({ context })),
          strictRequiredStatusChecksPolicy: false,
        },
        pullRequest: { requiredApprovingReviewCount: 0, requiredReviewThreadResolution: true },
      },
    }).pipe(retain());

    return {
      repository: `${owner}/${name}`,
      repositoryId: repository.repoId,
      environments: ["production", "release"],
      deployTokenId: deployToken.tokenId,
      rulesetId: ruleset.rulesetId,
      rulesetEnforcement: enforcement,
      requiredStatusChecks,
    };
  }),
);
