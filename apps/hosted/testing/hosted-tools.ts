/** Shared hosted account actions; host adapters own database and cookie configuration. */
import { Effect, Redacted, Schema, Semaphore } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import {
  DevtoolsState,
  LoopbackOrigin,
  TestRole,
  TestSignIn,
} from "@executor-js/devtools/contracts";
import { FixtureName, provisionTestAccount, type testAccountAuth } from "./accounts.ts";

const fixtures = [
  { role: "member", name: "rhys-member" },
  { role: "admin", name: "admin" },
  { role: "owner", name: "agent" },
] as const;

/** Seed fixed fixtures and accept same-origin requests only. Every sign-in renews a real session. */
export const hostedDevtools = (input: {
  readonly origin: string;
  readonly host: "cloud" | "self-host";
  readonly organization: string;
  readonly auth: ReturnType<typeof testAccountAuth>;
}) =>
  Effect.gen(function* () {
    const origin = yield* Schema.decodeUnknownEffect(LoopbackOrigin)(input.origin);
    const host = new URL(origin).host;
    const organization = yield* Schema.decodeUnknownEffect(FixtureName)(input.organization);
    const lock = yield* Semaphore.make(1);
    const provision = (fixture: (typeof fixtures)[number]) =>
      provisionTestAccount(input.auth, {
        host: input.host,
        origin,
        organization,
        ...fixture,
      }).pipe(lock.withPermits(1));
    const seeded = yield* Effect.forEach(fixtures, (fixture) =>
      provision(fixture).pipe(
        Effect.map((session) => {
          const value = Redacted.value(session);
          return { role: fixture.role, email: value.email, organizationId: value.organizationId };
        }),
      ),
    );
    const organizationId = Schema.decodeUnknownSync(Schema.String)(seeded[0]?.organizationId);
    const context = yield* Effect.promise(() => input.auth.$context);
    const status = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      if (request.headers.host !== host) return HttpServerResponse.empty({ status: 403 });
      const session = yield* Effect.tryPromise(() =>
        input.auth.api.getSession({
          headers: new Headers(request.headers),
          query: { disableRefresh: true, disableCookieCache: true },
        }),
      );
      const member =
        session === null
          ? null
          : yield* Effect.tryPromise(() =>
              context.adapter.findOne({
                model: "member",
                where: [
                  { field: "userId", value: session.user.id },
                  { field: "organizationId", value: organizationId },
                ],
              }),
            );
      const membership = yield* Schema.decodeUnknownEffect(
        Schema.NullOr(Schema.Struct({ role: TestRole })),
      )(member);
      const state = yield* Schema.decodeUnknownEffect(DevtoolsState)({
        kind: "accounts",
        host: input.host,
        organization,
        accounts: seeded.map(({ role, email }) => ({ role, email })),
        selected:
          seeded.find(
            (account) => account.email === session?.user.email && account.role === membership?.role,
          )?.role ?? null,
      });
      return yield* HttpServerResponse.json(state).pipe(
        Effect.map(HttpServerResponse.setHeader("cache-control", "no-store")),
      );
    }).pipe(Effect.catch(() => Effect.succeed(HttpServerResponse.empty({ status: 503 }))));
    const signIn = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      if (
        request.method !== "POST" ||
        request.headers.host !== host ||
        request.headers.origin !== origin
      )
        return HttpServerResponse.empty({ status: 403 });
      const body = yield* request.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(TestSignIn)));
      const fixture = fixtures.find((fixture) => fixture.role === body.role);
      if (fixture === undefined) return HttpServerResponse.empty({ status: 400 });
      const session = Redacted.value(yield* provision(fixture));
      let response = yield* HttpServerResponse.json({ status: true });
      for (const cookie of session.cookies)
        response = yield* HttpServerResponse.setCookie(response, cookie.name, cookie.value, {
          httpOnly: true,
          sameSite: "lax",
          secure: new URL(origin).protocol === "https:",
          path: "/",
          expires: new Date(session.expiresAt),
        });
      return HttpServerResponse.setHeader(response, "cache-control", "no-store");
    }).pipe(
      Effect.catchTag("HttpServerError", () =>
        Effect.succeed(HttpServerResponse.empty({ status: 400 })),
      ),
      Effect.catchTag("SchemaError", () =>
        Effect.succeed(HttpServerResponse.empty({ status: 400 })),
      ),
      Effect.catch(() => Effect.succeed(HttpServerResponse.empty({ status: 503 }))),
    );
    return { status, signIn };
  });
