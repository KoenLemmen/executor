/** Typed browser OAuth operations. Client secrets and callback URLs stay redacted in Atom state. */
import { Effect, Schema, type Redacted } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { AppId, AccountId, AccountConnectionId } from "@executor-js/sdk";
import { DashboardClient, appAtom, toolsAtom } from "./api.ts";
import { accountCredentialsChanged } from "./accounts.ts";
import { invalidate } from "@executor-js/ui/contracts/mutations";

/** Resolve automatic or supplied client configuration, then navigate to provider consent. */
export const startOAuthAtom = DashboardClient.mutation("dashboard", "startOAuth");
/** Keep the entry callback alive while auth/inventory gates load. Never written to browser storage. */
export const oauthCallbackAtom = Atom.make<Redacted.Redacted<string> | undefined>(undefined).pipe(
  Atom.keepAlive,
);
/** Safe navigation intent; the server separately owns provider, owner and credential identity. */
const OAuthAppReturn = Schema.Struct({
  connection: AccountConnectionId,
  app: AppId,
  slot: Schema.NonEmptyString,
});
export const OAuthReturn = Schema.Union([
  OAuthAppReturn,
  Schema.Struct({ connection: AccountConnectionId, account: AccountId }),
  Schema.Struct({ connection: AccountConnectionId }),
]);
/** Finish once per document load, even if React remounts the page. */
export const completeOAuthAtom = DashboardClient.runtime
  .atom((get) =>
    Effect.gen(function* () {
      const callbackUrl = get.once(oauthCallbackAtom);
      if (callbackUrl === undefined) return undefined;
      const client = yield* DashboardClient;
      const saved = sessionStorage.getItem("executor.oauth.return");
      const target =
        saved === null
          ? undefined
          : yield* Schema.decodeUnknownEffect(Schema.fromJsonString(OAuthReturn))(saved);
      if (target === undefined) return undefined;
      const savedAccount = yield* client.dashboard.completeOAuth({
        payload: { connection: target.connection, callbackUrl },
      });
      accountCredentialsChanged(get, savedAccount);
      if (Schema.is(OAuthAppReturn)(target)) {
        invalidate(get, appAtom(target.app));
        get.refresh(toolsAtom(target.app));
      }
      return savedAccount;
    }),
  )
  .pipe(Atom.keepAlive);
