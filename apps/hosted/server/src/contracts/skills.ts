import { RequiredAction } from "./authorization.ts";
/** Organization-scoped skill reads expose only the skill directory, never general app source. */
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import {
  AppId,
  DeploymentId,
  AppSkillName,
  AppSkillCatalog,
  AppSkillDocument,
  AppSkillErrors,
  AppSkillNotFound,
  SourceFilePath,
} from "@executor-js/sdk/core";
import { OrganizationId, RequireOrganization } from "./organization.ts";

const app = { organization: OrganizationId, app: AppId };
const version = { deployment: Schema.optional(DeploymentId) };
const prefix = "/api/organizations/:organization/apps/:app/skills";
/** Membership authorizes static instructions; account setup is not required. */
export const HostedSkills = HttpApiGroup.make("skills")
  .add(
    HttpApiEndpoint.get("list", prefix, {
      params: app,
      query: version,
      success: AppSkillCatalog,
      error: AppSkillErrors,
    }).annotate(RequiredAction, "discover"),
  )
  .add(
    HttpApiEndpoint.get("read", `${prefix}/:name`, {
      params: { ...app, name: AppSkillName },
      query: { ...version, file: Schema.optional(SourceFilePath) },
      success: AppSkillDocument,
      error: [...AppSkillErrors, AppSkillNotFound],
    }).annotate(RequiredAction, "discover"),
  )
  .middleware(RequireOrganization);
