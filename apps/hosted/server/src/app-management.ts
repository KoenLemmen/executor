import { permitsAction, permittedAppIds } from "@executor-js/authorization";
import { CurrentAuthorization } from "./contracts/authorization.ts";
import { OrganizationForbidden } from "./contracts/organization.ts";
import { requireOrganizationAdmin } from "./implementation/access.ts";
import { HostedAppAccess } from "./contracts/app-management.ts";
import { withOrganizationRequest } from "./implementation/organization.ts";
/** Hosted app source uses current organization membership and existing API OAuth grants. */
import { AppIdentity, AppGitAccess, AppAccessDenied } from "@executor-js/app-management";
import { Effect, Encoding, Layer, Schema } from "effect";
import { ApiAuthentication, Authentication } from "./contracts/auth.ts";
import { OrganizationReference, CurrentOrganization } from "./contracts/organization.ts";

export const hostedAppAccess = Layer.effect(
  HostedAppAccess,
  Effect.gen(function* () {
    const api = yield* ApiAuthentication;
    const auth = yield* Authentication;
    return (response, { endpoint }) =>
      withOrganizationRequest(
        (namespace) =>
          Effect.gen(function* () {
            const access = yield* endpoint.identifier === "list" ||
            endpoint.identifier === "catalog"
              ? CurrentOrganization
              : requireOrganizationAdmin;
            const policy = yield* CurrentAuthorization;
            if (
              ["create", "copy", "published", "unpublish"].includes(endpoint.identifier) &&
              policy.tools.kind !== "all"
            )
              return yield* new OrganizationForbidden();
            return yield* response.pipe(
              Effect.provideService(AppIdentity, {
                owner: access.owner,
                readOwner: access.owner,
                scope: access.organization,
                namespace: yield* namespace,
                canWrite: access.role !== "member",
                protectedApps: [],
                appIds: permittedAppIds(policy),
              }),
            );
          }),
        endpoint.identifier === "list" || endpoint.identifier === "catalog"
          ? "discover"
          : endpoint.identifier === "source" ||
              endpoint.identifier === "history" ||
              endpoint.identifier === "published"
            ? "read"
            : "manage",
      ).pipe(
        Effect.provideService(Authentication, auth),
        Effect.provideService(ApiAuthentication, api),
      );
  }),
);

/** Git Basic passwords carry API tokens; browser cookies cannot authorize a Git push or clone. */
export const hostedAppGitAccess = Layer.effect(
  AppGitAccess,
  Effect.gen(function* () {
    const api = yield* ApiAuthentication;
    return AppGitAccess.of({
      authenticate: (request, scope) =>
        Effect.gen(function* () {
          if (request.headers.origin !== undefined)
            return yield* new AppAccessDenied({ reason: "forbidden" });
          const authorization = request.headers.authorization;
          if (authorization === undefined)
            return yield* new AppAccessDenied({ reason: "authentication" });
          let token: string;
          if (authorization.startsWith("Basic ")) {
            const decoded = yield* Effect.fromResult(
              Encoding.decodeBase64String(authorization.slice(6)),
            );
            const colon = decoded.indexOf(":");
            if (colon < 0) return yield* new AppAccessDenied({ reason: "authentication" });
            token = decoded.slice(colon + 1);
          } else if (authorization.startsWith("Bearer ")) token = authorization.slice(7);
          else return yield* new AppAccessDenied({ reason: "authentication" });
          const grant = yield* api.authenticate(
            new Headers({ authorization: `Bearer ${token}` }),
            yield* Schema.decodeUnknownEffect(OrganizationReference)(scope),
          );
          if (
            (grant.access.organization !== scope && grant.organizationSlug !== scope) ||
            grant.access.role === "member" ||
            !permitsAction(grant.policy, "read")
          )
            return yield* new AppAccessDenied({ reason: "forbidden" });
          return {
            owner: grant.access.owner,
            readOwner: grant.access.owner,
            scope: grant.access.organization,
            namespace: grant.organizationSlug,
            canWrite: permitsAction(grant.policy, "manage"),
            appIds: permittedAppIds(grant.policy),
            protectedApps: [],
          };
        }).pipe(
          Effect.mapError((error) =>
            Schema.is(AppAccessDenied)(error)
              ? error
              : new AppAccessDenied({ reason: "authentication" }),
          ),
        ),
    });
  }),
);
