/**
 * Production-side hardening for Better Auth's `oAuthProxy` plugin.
 *
 * The plugin trusts anything encrypted with the shared proxy secret. Without this
 * guard, that secret alone lets its holder (1) point production's code exchange at
 * an arbitrary redirect target that then receives the provider tokens, and
 * (2) mint a production session for any email through the completion endpoints
 * that the plugin registers on every host. Production is never the receiving side,
 * so both paths are closed here. Place this plugin before `oAuthProxy` so its hooks
 * run first.
 */
import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { symmetricDecrypt } from "better-auth/crypto";

/** Endpoints that only a test stage needs; production must not accept a profile. */
const completionPaths = new Set(["/callback/:id/oauth-proxy", "/oauth-proxy-callback"]);

const proxiedRedirectOrigin = async (
  secret: string,
  state: unknown,
): Promise<string | undefined> => {
  if (typeof state !== "string" || state.length === 0) return undefined;
  let statePackage: unknown;
  try {
    statePackage = JSON.parse(await symmetricDecrypt({ key: secret, data: state }));
  } catch {
    // Not a proxy package. Production's own sign-ins use the regular callback.
    return undefined;
  }
  if (
    typeof statePackage !== "object" ||
    statePackage === null ||
    !("isOAuthProxy" in statePackage) ||
    statePackage.isOAuthProxy !== true ||
    !("stateCookie" in statePackage) ||
    typeof statePackage.stateCookie !== "string"
  )
    return undefined;
  const stateData: unknown = JSON.parse(
    await symmetricDecrypt({ key: secret, data: statePackage.stateCookie }),
  );
  if (
    typeof stateData !== "object" ||
    stateData === null ||
    !("callbackURL" in stateData) ||
    typeof stateData.callbackURL !== "string"
  )
    throw new APIError("BAD_REQUEST", { message: "OAuth proxy state is missing its redirect." });
  return new URL(stateData.callbackURL).origin;
};

/** Only allow proxied sign-ins to return to a trusted origin, and never complete one here. */
export const oauthProxyProductionGuard = (secret: string) =>
  ({
    id: "executor-oauth-proxy-production-guard",
    hooks: {
      before: [
        {
          matcher: (context) => context.path !== undefined && completionPaths.has(context.path),
          handler: createAuthMiddleware(async () => {
            throw new APIError("NOT_FOUND");
          }),
        },
        {
          matcher: (context) => context.path === "/callback/:id",
          handler: createAuthMiddleware(async (context) => {
            const origin = await proxiedRedirectOrigin(
              secret,
              context.query?.state ?? context.body?.state,
            );
            if (origin === undefined) return;
            if (!context.context.isTrustedOrigin(origin))
              throw new APIError("FORBIDDEN", {
                message: "OAuth proxy redirect target is not a trusted origin.",
              });
          }),
        },
      ],
    },
  }) satisfies BetterAuthPlugin;
