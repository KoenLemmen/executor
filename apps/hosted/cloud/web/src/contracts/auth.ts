import { BrowserAtoms } from "@executor-js/hosted-web/contracts/telemetry";
import { passkeyClient } from "@better-auth/passkey/client";
import { createAuthClient } from "better-auth/client";
import { emailOTPClient } from "better-auth/client/plugins";
import { authRequest, sessionAtom } from "@executor-js/hosted-web/contracts/auth";
import { Effect } from "effect";
import { invalidate } from "@executor-js/ui/contracts/mutations";

/** Cloud-only credentials; shared session queries use the same origin and cookie. */
export const cloudAuthClient = createAuthClient({ plugins: [passkeyClient(), emailOTPClient()] });
/** Send one short-lived sign-in code without exposing whether an account exists. */
export const sendCodeAtom = BrowserAtoms.fn((email: string) =>
  authRequest((options) =>
    cloudAuthClient.emailOtp.sendVerificationOtp({ email, type: "sign-in" }, options),
  ).pipe(Effect.withSpan("ui.auth.sendCode"), Effect.asVoid),
);
/** Successful code verification also proves email ownership. */
export const verifyCodeAtom = BrowserAtoms.fn((input: { email: string; otp: string }, get) =>
  authRequest((options) => cloudAuthClient.signIn.emailOtp(input, options)).pipe(
    Effect.withSpan("ui.auth.signIn"),
    Effect.tap(() => Effect.sync(() => invalidate(get, sessionAtom))),
    Effect.asVoid,
  ),
);
/** Start the browser's WebAuthn ceremony only after an explicit click. */
export const passkeySignInAtom = BrowserAtoms.fn((_: void, get) =>
  authRequest((options) => cloudAuthClient.signIn.passkey({}, options)).pipe(
    Effect.withSpan("ui.auth.signIn"),
    Effect.tap(() => Effect.sync(() => invalidate(get, sessionAtom))),
    Effect.asVoid,
  ),
);
/** Register with the server's configured origin and relying-party identity. */
export const addPasskeyAtom = BrowserAtoms.fn((name: string) =>
  authRequest((options) => cloudAuthClient.passkey.addPasskey({ name }, options)).pipe(
    Effect.withSpan("ui.auth.addPasskey"),
    Effect.asVoid,
  ),
);
