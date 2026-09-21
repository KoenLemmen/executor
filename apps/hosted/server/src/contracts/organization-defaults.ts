import { Unauthorized, AuthenticationUnavailable, Forbidden, type AccountApiKey } from "./auth.ts";
import { Context, Schema, type Effect, type Scope } from "effect";
import {
  AccountNotFound,
  AccountFieldsInvalid,
  AuthMethodInvalid,
  ProviderNotFound,
  CredentialsError,
  AccountSelectionInvalid,
  AppNotFound,
  AppDeploymentChanged,
  DeploymentBuildFailed,
  DeploymentNotFound,
  AppNameTaken,
  AppSlugTaken,
  SkillDefinitionInvalid,
  StorageError,
} from "@executor-js/sdk/core";
import { TemplateError } from "@executor-js/app-templates";
import type { OrganizationId } from "./organization.ts";

/** Setup preserves safe generation and deployment failures alongside storage failures. */
export const OrganizationDefaultsError = Schema.Union([
  Unauthorized,
  AuthenticationUnavailable,
  Forbidden,
  StorageError,
  TemplateError.annotate({ httpApiStatus: 422 }),
  DeploymentBuildFailed,
  DeploymentNotFound,
  AppNameTaken,
  AppSlugTaken,
  SkillDefinitionInvalid,
  AppNotFound,
  AppDeploymentChanged,
  AccountNotFound,
  AccountFieldsInvalid,
  AuthMethodInvalid,
  ProviderNotFound,
  CredentialsError,
  AccountSelectionInvalid,
]);
/** Verified dashboard identity and scoped creation of a key for a new saved account. */
export interface ExecutorUserAccount {
  readonly userId: string;
  readonly name: string;
  readonly key: Effect.Effect<
    AccountApiKey,
    Unauthorized | Forbidden | AuthenticationUnavailable,
    Scope.Scope
  >;
}

/** One-time product setup; installed apps retain their ordinary lifecycle afterward. */
export class OrganizationDefaults extends Context.Service<
  OrganizationDefaults,
  (
    organization: OrganizationId,
    user?: ExecutorUserAccount,
  ) => Effect.Effect<void, typeof OrganizationDefaultsError.Type>
>()("hosted/OrganizationDefaults") {}
