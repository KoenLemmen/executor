import { DeclaredRequirements } from "apps/contracts";
import { AppSlug } from "./app-slug.ts";
export { AppSlug, appSlug } from "./app-slug.ts";
/** Configured apps: deployed code, declared requirements and saved account selections. */
import { Schema } from "effect";
import { SkillDefinitionInvalid } from "./skill-source.ts";
import { StorageError } from "./shared.ts";
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi";
import { AccountId, AppCodeId, AppId, DeploymentId, OwnerId, ProviderId } from "./shared.ts";
import { AccountNotFound } from "./account.ts";
import { ProviderDefinition } from "./provider.ts";
import {
  AppDeploymentChanged,
  Deployment,
  DeploymentBuildFailed,
  DeploymentNotFound,
  DeploymentSummary,
  SourceFiles,
} from "./deployment.ts";

/**
 * A host-resolved account requirement. Available before accounts are selected
 * and before the dynamic factory runs. Provider metadata is data, not JS code.
 */
export const AccountRequirement = Schema.Struct({
  provider: ProviderId,
  definition: ProviderDefinition,
  cardinality: Schema.Literals(["one", "many"]),
});

export type AccountRequirement = typeof AccountRequirement.Type;

/** App-wide requirements, extracted from the deployed app's declaration. */
export const AppRequirements = Schema.Struct({
  database: DeclaredRequirements.fields.database,
  accounts: Schema.Record(Schema.NonEmptyString, AccountRequirement),
});

export type AppRequirements = typeof AppRequirements.Type;

/** Saved slot -> account ID or account IDs. Empty arrays explicitly select zero for many(). */
export const SelectedAccounts = Schema.Record(
  Schema.NonEmptyString,
  Schema.Union([AccountId, Schema.Array(AccountId)]),
);

export type SelectedAccounts = typeof SelectedAccounts.Type;

/** Display names are nonblank and bounded; they do not replace stable app identities. */
export const AppName = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(120),
  Schema.isPattern(/\S/),
);

/**
 * One configured app. Copies share code/deployments and provider references,
 * while keeping independent names, owners and selected account IDs. An app
 * can exist with incomplete selections while being configured. Execution
 * requires every declared slot, including explicit [] for an empty collection.
 */
export const App = Schema.Struct({
  id: AppId,
  slug: AppSlug,
  code: AppCodeId,
  owner: OwnerId,
  name: Schema.NonEmptyString,
  activeDeployment: DeploymentId,
  requirements: AppRequirements,
  accounts: SelectedAccounts,
  createdAt: Schema.Date,
});

export type App = typeof App.Type;

/** Public deploy input, keyed either by the owner's app name or stable app id. */
export const DeployAppInput = Schema.Union([
  Schema.Struct({
    owner: OwnerId,
    name: Schema.NonEmptyString,
    files: SourceFiles,
    createOnly: Schema.optional(Schema.Boolean),
    app: Schema.optional(Schema.Never),
    expectedDeployment: Schema.optional(Schema.Never),
  }),
  Schema.Struct({
    owner: OwnerId,
    app: AppId,
    expectedDeployment: DeploymentId,
    files: SourceFiles,
    name: Schema.optional(Schema.Never),
    createOnly: Schema.optional(Schema.Never),
  }),
]);

export type DeployAppInput = typeof DeployAppInput.Type;

/** No app matched the ID and any supplied owner constraint. */
export class AppNotFound extends Schema.TaggedError<AppNotFound>()(
  "AppNotFound",
  { app: AppId },
  { httpApiStatus: 404, description: "No app matches this id and any supplied owner constraint." },
) {}

/** Adding a configured copy must not overwrite an existing app with that name. */
export class AppNameTaken extends Schema.TaggedError<AppNameTaken>()(
  "AppNameTaken",
  { owner: OwnerId, name: Schema.String },
  { httpApiStatus: 409, description: "An app already uses this name for this owner." },
) {}

/** Another configured app already owns this readable address for this owner. */
export class AppSlugTaken extends Schema.TaggedError<AppSlugTaken>()(
  "AppSlugTaken",
  {
    owner: OwnerId,
    slug: AppSlug,
  },
  {
    httpApiStatus: 409,
    description: "Another app name produces this address. Choose a different name.",
  },
) {}

/** A saved selection does not match the app's declared provider or cardinality. */
export class AccountSelectionInvalid extends Schema.TaggedError<AccountSelectionInvalid>()(
  "AccountSelectionInvalid",
  {
    app: AppId,
    slot: Schema.String,
    reason: Schema.Literals([
      "unknown_slot",
      "expected_one",
      "expected_many",
      "provider_mismatch",
      "duplicate_account",
    ]),
  },
  { httpApiStatus: 422, description: "Select accounts that match the app requirement." },
) {}

/** A required account selection is missing; a new app can be configured before it can run. */
export class AccountRequired extends Schema.TaggedError<AccountRequired>()(
  "AccountRequired",
  { app: AppId, deployment: DeploymentId, slot: Schema.String },
  {
    httpApiStatus: 409,
    description: "Select accounts for every app requirement before running it.",
  },
) {}

/** Stop and clean up webhook subscriptions before deleting their configured app. */
export class AppWebhooksActive extends Schema.TaggedError<AppWebhooksActive>()(
  "AppWebhooksActive",
  { app: AppId },
  { httpApiStatus: 409, description: "Remove the app's webhook subscriptions before deleting it." },
) {}

/** A configured app owns active runs and cannot disappear while they execute. */
export class AppWorkflowsActive extends Schema.TaggedError<AppWorkflowsActive>()(
  "AppWorkflowsActive",
  { app: AppId },
  {
    httpApiStatus: 409,
    description: "Terminate the app's active workflow runs before deleting it.",
  },
) {}

/** Canonical operation inputs; Promise and HTTP callers use the same validators. */
export const AppInputs = {
  deploy: DeployAppInput,
  add: Schema.Struct({ from: AppId, owner: OwnerId, name: Schema.NonEmptyString }),
  get: Schema.Struct({ app: AppId, owner: Schema.optional(OwnerId) }),
  // Omitted IDs select all apps for the owner; an empty list selects none.
  list: Schema.Struct({
    owner: Schema.optional(OwnerId),
    ids: Schema.optional(Schema.Array(AppId)),
    name: Schema.optional(AppName),
    slug: Schema.optional(AppSlug),
    account: Schema.optional(AccountId),
  }),
  update: Schema.Struct({ app: AppId, accounts: SelectedAccounts }),
  activate: Schema.Struct({
    app: AppId,
    deployment: DeploymentId,
    owner: Schema.optional(OwnerId),
    expectedDeployment: Schema.optional(DeploymentId),
  }),
  rename: Schema.Struct({
    app: AppId,
    owner: Schema.optional(OwnerId),
    name: AppName,
  }),
  source: Schema.Struct({
    app: AppId,
    owner: Schema.optional(OwnerId),
    deploymentOwner: Schema.optional(OwnerId),
    deployment: Schema.optional(DeploymentId),
  }),
  // `deploymentOwner` is separate from `owner`: owner selects the configured app.
  deployments: Schema.Struct({
    app: AppId,
    owner: Schema.optional(OwnerId),
    deploymentOwner: Schema.optional(OwnerId),
  }),
};
const appParams = { app: AppInputs.get.fields.app };
const ownerQuery = { owner: AppInputs.get.fields.owner };

/**
 * deploy retains the one-step create/build/activate flow keyed by (owner,name).
 * add makes another configured copy from an existing app, without rebuilding
 * or copying its account selections. update replaces the whole selection map.
 * These operations manage configured apps; they do not author HTTP endpoints in app code.
 */
export const AppsGroup = HttpApiGroup.make("apps")
  .add(
    HttpApiEndpoint.post("deploy", "/v1/apps/deploy", {
      payload: AppInputs.deploy,
      success: Schema.Struct({ app: App, deployment: Deployment }),
      error: [
        StorageError,
        DeploymentBuildFailed,
        SkillDefinitionInvalid,
        AppNameTaken,
        AppSlugTaken,
        AppNotFound,
        AppDeploymentChanged,
        AccountNotFound,
        AccountSelectionInvalid,
      ],
    }).annotate(
      OpenApi.Description,
      "Deploy app source files. index.ts exports defineApp from apps. Creates or updates by owner and name, or updates by app ID and expected deployment. Activates only after a successful build. Discover tools in the next execute call.",
    ),
  )
  .add(
    HttpApiEndpoint.post("add", "/v1/apps", {
      payload: AppInputs.add,
      success: App,
      error: [StorageError, AppNotFound, AppNameTaken, AppSlugTaken],
    }).annotate(
      OpenApi.Description,
      "Create another configured copy of an existing app. Code is shared; account selections start empty.",
    ),
  )
  .add(
    HttpApiEndpoint.get("get", "/v1/apps/:app", {
      params: appParams,
      query: ownerQuery,
      success: App,
      error: [StorageError, AppNotFound],
    }).annotate(
      OpenApi.Description,
      "Inspect a configured app, its account requirements and saved selections.",
    ),
  )
  .add(
    HttpApiEndpoint.get("list", "/v1/apps", {
      query: {
        owner: AppInputs.list.fields.owner,
        name: AppInputs.list.fields.name,
        slug: AppInputs.list.fields.slug,
        account: AppInputs.list.fields.account,
        // A JSON query value preserves [] instead of dropping it as an absent query parameter.
        ids: Schema.optional(Schema.fromJsonString(Schema.Array(AppId))),
      },
      success: Schema.Array(App),
      error: [StorageError],
    }).annotate(
      OpenApi.Description,
      "List configured apps, requirements and saved selections. Owner is an optional lookup filter.",
    ),
  )
  // Idempotent removal of one configured copy; accounts and retained code are independent.
  .add(
    HttpApiEndpoint.delete("remove", "/v1/apps/:app", {
      params: appParams,
      query: ownerQuery,
      success: Schema.Struct({ app: AppId }),
      error: [StorageError, AppWebhooksActive, AppWorkflowsActive],
    }).annotate(
      OpenApi.Description,
      "Delete one configured app and its selections. Saved accounts, retained deployments and other copies are kept. Repeating removal is safe.",
    ),
  )
  .add(
    HttpApiEndpoint.patch("rename", "/v1/apps/:app/name", {
      params: appParams,
      query: ownerQuery,
      payload: Schema.Struct({
        name: AppInputs.rename.fields.name,
      }),
      success: App,
      error: [StorageError, AppNotFound, AppNameTaken, AppSlugTaken],
    }).annotate(
      OpenApi.Description,
      "Rename an app and derive its new slug. The name and normalized slug must be unique within its owner.",
    ),
  )
  .add(
    HttpApiEndpoint.patch("update", "/v1/apps/:app", {
      params: appParams,
      payload: Schema.Struct({ accounts: AppInputs.update.fields.accounts }),
      success: App,
      // Validate all supplied slots/accounts before replacing the map. Missing
      // selections are allowed during setup; tools fail AccountRequired until ready.
      error: [StorageError, AppNotFound, AccountNotFound, AccountSelectionInvalid],
    }).annotate(
      OpenApi.Description,
      "Replace the whole account selection map. Include every slot to keep. Each value is an account ID, or an array of IDs for a many requirement. Omitted slots become unconfigured.",
    ),
  )
  .add(
    HttpApiEndpoint.post("activate", "/v1/apps/:app/activate", {
      params: appParams,
      query: ownerQuery,
      payload: Schema.Struct({
        deployment: AppInputs.activate.fields.deployment,
        expectedDeployment: AppInputs.activate.fields.expectedDeployment,
      }),
      success: App,
      // Same code lineage only. Validate saved selections against the candidate
      // requirements before changing the pointer; no migration or auto-rebinding.
      error: [
        StorageError,
        AppNotFound,
        DeploymentNotFound,
        AppDeploymentChanged,
        AccountNotFound,
        AccountSelectionInvalid,
      ],
    }).annotate(
      OpenApi.Description,
      "Activate a retained deployment in the same code lineage. Existing account selections must remain compatible. expectedDeployment rejects a concurrent activation.",
    ),
  )
  .add(
    HttpApiEndpoint.get("deployments", "/v1/apps/:app/deployments", {
      params: appParams,
      query: {
        owner: AppInputs.deployments.fields.owner,
        deploymentOwner: AppInputs.deployments.fields.deploymentOwner,
      },
      success: Schema.Array(DeploymentSummary),
      error: [StorageError, AppNotFound],
    }).annotate(OpenApi.Description, "List retained deployments in the app code lineage."),
  )
  .add(
    HttpApiEndpoint.get("source", "/v1/apps/:app/source", {
      params: { app: AppId },
      query: {
        owner: AppInputs.source.fields.owner,
        deploymentOwner: AppInputs.source.fields.deploymentOwner,
        deployment: AppInputs.source.fields.deployment,
      },
      success: Deployment,
      error: [StorageError, AppNotFound, DeploymentNotFound],
    }).annotate(
      OpenApi.Description,
      "Read source files for a retained deployment in the app code lineage.",
    ),
  );
