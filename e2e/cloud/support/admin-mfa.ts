import { Effect, Option, Schema } from "effect";
import { TOTP } from "otpauth";
import type { Identity } from "../../src/target";

const Setup = Schema.Struct({ kind: Schema.Literal("enroll"), secret: Schema.String });
const decodeSetup = Schema.decodeUnknownOption(Setup);
const Verified = Schema.Struct({ verified: Schema.Literal(true) });
const decodeVerified = Schema.decodeUnknownOption(Verified);

/** Apply response cookie rotations and deletions to a test client's cookie header. */
export const responseCookies = (current: string, response: Response): string => {
  const cookies = new Map(browserCookies(current).map(({ name, value }) => [name, value]));
  for (const header of response.headers.getSetCookie()) {
    const pair = header.split(";")[0];
    if (!pair) throw new Error("Empty response cookie");
    const separator = pair.indexOf("=");
    if (separator < 1) throw new Error("Invalid response cookie");
    const name = pair.slice(0, separator);
    if (/;\s*max-age=0(?:;|$)/i.test(header)) cookies.delete(name);
    else cookies.set(name, pair.slice(separator + 1));
  }
  return [...cookies].map(([name, value]) => `${name}=${value}`).join("; ");
};

/** Read all cookie pairs, including admin verification, into browser fixtures. */
export const browserCookies = (cookie: string): NonNullable<Identity["cookies"]> =>
  cookie
    .split(";")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const separator = pair.indexOf("=");
      if (separator < 1) throw new Error("Invalid test cookie");
      const name = pair.slice(0, separator);
      return {
        name,
        value: pair.slice(separator + 1),
        ...(name.startsWith("__Host-") ? { secure: true } : {}),
      };
    });

/** Enroll a fresh test admin through the real product and the installed WorkOS emulator. */
export const verifyFreshAdmin = (baseUrl: string, identity: Identity): Effect.Effect<Identity> =>
  Effect.promise(async () => {
    const headers = {
      ...identity.headers,
      origin: new URL(baseUrl).origin,
      "content-type": "application/json",
    };
    const started = await fetch(new URL("/api/auth/admin-mfa/start", baseUrl), {
      method: "POST",
      headers,
      body: "{}",
    });
    if (!started.ok) throw new Error(`Admin enrollment failed (${started.status})`);
    const setup = Option.getOrNull(decodeSetup(await started.json()));
    if (!setup) throw new Error("Expected a fresh MFA enrollment");
    const pending = responseCookies(identity.headers?.cookie ?? "", started);
    const verified = await fetch(new URL("/api/auth/admin-mfa/verify", baseUrl), {
      method: "POST",
      headers: { ...headers, cookie: pending },
      body: JSON.stringify({ code: new TOTP({ secret: setup.secret }).generate() }),
    });
    if (!verified.ok || Option.isNone(decodeVerified(await verified.json())))
      throw new Error(`Admin verification failed (${verified.status})`);
    const proof = verified.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith("__Host-executor-admin-mfa="))
      ?.split(";")[0];
    if (!proof) throw new Error("Admin verification set no proof cookie");
    const cookie = responseCookies(pending, verified);
    return {
      ...identity,
      headers: { ...identity.headers, cookie },
      cookies: browserCookies(cookie),
    };
  });
