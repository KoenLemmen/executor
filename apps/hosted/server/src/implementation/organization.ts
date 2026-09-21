import { readOrganizationIconUpload } from "./organization-icons.ts";
import { requireOrganizationAdmin } from "./access.ts";
import { CurrentPrincipal, CurrentUserId } from "../contracts/auth.ts";
import { APIError } from "better-auth/api";
import { Effect, Layer, Option, Schema } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import type { OwnerId } from "@executor-js/sdk/core";
import { HostedApi } from "../contracts/api.ts";
import { HostedCatalog } from "../contracts/catalog.ts";
import { HostedExecutor } from "../contracts/executor.ts";
import { OrganizationDefaults } from "../contracts/organization-defaults.ts";
import { Cookies, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import {
  ApiAuthentication,
  Authentication,
  AuthenticationUnavailable,
  Forbidden,
  Unauthorized,
} from "../contracts/auth.ts";
import {
  CurrentOrganization,
  OrganizationIcons,
  OrganizationForbidden,
  OrganizationReference,
  OrganizationRole,
  RequireOrganization,
  organizationOwner,
} from "../contracts/organization.ts";

/** Adapt the public Better Auth role endpoint, preserving any renewed session cookies. */
export const lookupMembership = (
  call: () => Promise<{ headers: Headers; response: { role: string } }>,
) =>
  Effect.tryPromise({
    try: call,
    catch: (cause) =>
      cause instanceof APIError && (cause.statusCode === 401 || cause.statusCode === 403)
        ? new OrganizationForbidden()
        : new AuthenticationUnavailable(),
  }).pipe(
    Effect.flatMap(({ headers, response }) =>
      Schema.decodeUnknownEffect(OrganizationRole)(response.role).pipe(
        Effect.map((role) => ({ role, headers })),
        Effect.mapError(() => new OrganizationForbidden()),
      ),
    ),
  );

/** Resolve a checked organization ID for canonical return links without session selection. */
export const lookupOrganizationSlug = (call: () => Promise<unknown>) =>
  Effect.tryPromise({
    try: call,
    catch: (cause) =>
      cause instanceof APIError && (cause.statusCode === 401 || cause.statusCode === 403)
        ? new OrganizationForbidden()
        : new AuthenticationUnavailable(),
  }).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Struct({ slug: Schema.NonEmptyString }))),
    Effect.map((organization) => organization.slug),
    Effect.catchTag("SchemaError", () => Effect.fail(new AuthenticationUnavailable())),
  );

/** Access resolves only the explicit route ID or slug. Shared session preferences never participate. */
export const requireOrganizationLive = Layer.effect(
  RequireOrganization,
  Effect.gen(function* () {
    const auth = yield* Authentication;
    const api = yield* ApiAuthentication;
    return (response) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const headers = new Headers(request.headers);
        const params = yield* HttpRouter.params;
        const reference = yield* Schema.decodeUnknownEffect(OrganizationReference)(
          params.organization,
        ).pipe(Effect.mapError(() => new OrganizationForbidden()));
        if (headers.has("authorization")) {
          if (request.headers.origin !== undefined && request.headers.origin !== auth.origin)
            return yield* new Forbidden();
          const grant = yield* api.authenticate(headers, reference);
          return (yield* response.pipe(
            Effect.provideService(CurrentOrganization, grant.access),
            Effect.provideService(CurrentUserId, grant.userId),
          )).pipe(HttpServerResponse.setHeader("cache-control", "no-store"));
        }
        if (
          request.method !== "GET" &&
          request.method !== "HEAD" &&
          request.headers.origin !== auth.origin
        )
          return yield* new Forbidden();
        const principal = yield* auth.current(headers);
        if (principal === null) return yield* new Unauthorized();
        const organization = yield* auth.organization(reference);
        const membership = yield* auth.membership(headers, organization);
        const access = {
          organization,
          owner: organizationOwner(organization),
          role: membership.role,
        };
        return (yield* response.pipe(
          Effect.provideService(CurrentOrganization, access),
          Effect.provideService(CurrentUserId, principal.userId),
          Effect.provideService(CurrentPrincipal, principal),
        )).pipe(
          HttpServerResponse.mergeCookies(Cookies.fromSetCookie(membership.headers.getSetCookie())),
          HttpServerResponse.setHeader("cache-control", "no-store"),
        );
      });
  }),
);

/** List organization metadata through the SDK without evaluating app code. */
export const inventory = (owner: OwnerId) =>
  Effect.gen(function* () {
    const executor = yield* Effect.flatten(HostedExecutor);
    return yield* Effect.all({
      apps: executor.apps.list({ owner }),
      accounts: executor.accounts.list({ owner }),
    });
  });
/** Organization routes do not own app/account operations. */
export const hostedOrganizationHandlers = HttpApiBuilder.group(
  HostedApi,
  "organization",
  (handlers) =>
    Effect.gen(function* () {
      const authentication = yield* Authentication;
      return handlers
        .handleRaw("uploadIcon", () =>
          Effect.gen(function* () {
            const organization = yield* requireOrganizationAdmin;
            const image = yield* readOrganizationIconUpload;
            return yield* (yield* OrganizationIcons).upload(organization.organization, image);
          }),
        )
        .handle("icon", ({ params }) =>
          Effect.gen(function* () {
            const organization = yield* CurrentOrganization;
            const image = yield* (yield* OrganizationIcons).read(
              organization.organization,
              params.key,
            );
            return HttpServerResponse.uint8Array(image.bytes, {
              contentType: image.contentType,
              headers: { "x-content-type-options": "nosniff" },
            });
          }),
        )
        .handle("catalog", () => Effect.flatMap(HostedCatalog, (catalog) => catalog.list))
        .handle("access", () => CurrentOrganization)
        .handle("inventory", () =>
          Effect.gen(function* () {
            const organization = yield* CurrentOrganization;
            const request = yield* HttpServerRequest.HttpServerRequest;
            const headers = new Headers(request.headers);
            const principal =
              organization.role === "member" ||
              headers.has("authorization") ||
              !headers.has("cookie")
                ? null
                : Option.getOrUndefined(yield* Effect.serviceOption(CurrentPrincipal));
            yield* (yield* OrganizationDefaults)(
              organization.organization,
              principal == null
                ? undefined
                : {
                    userId: principal.userId,
                    name: principal.name,
                    key: authentication
                      .apiKey(headers)
                      .pipe(
                        Effect.catchTag("OrganizationForbidden", () =>
                          Effect.fail(new Forbidden()),
                        ),
                      ),
                  },
            );
            return yield* inventory(organization.owner);
          }),
        );
    }),
);
