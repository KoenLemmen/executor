/** Account queries remain independent across organizations, including OAuth returns. */
import type { Account, AccountId } from "@executor-js/sdk";
import type { OrganizationReference } from "@executor-js/hosted-server/organization";
import { Data, Effect, Option } from "effect";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import {
  acknowledge,
  acknowledgedQuery,
  upsert,
  invalidate,
} from "@executor-js/ui/contracts/mutations";
import { HostedClient } from "./api.ts";
import { inventoryAtom } from "./organization.ts";
import { appAtom, toolsAtom } from "./apps.ts";

class AccountKey extends Data.Class<{
  readonly organization: OrganizationReference;
  readonly account: AccountId;
}> {}
const accountQuery = Atom.family((key: AccountKey) =>
  HostedClient.query("accounts", "get", { params: key }).pipe(
    Atom.refreshOnWindowFocus,
    acknowledgedQuery,
  ),
);
export const accountAtom = (key: {
  readonly organization: OrganizationReference;
  readonly account: AccountId;
}) => accountQuery(new AccountKey(key));
const renameAccount = Atom.family((key: AccountKey) =>
  HostedClient.runtime.fn((label: string, get) =>
    Effect.flatMap(HostedClient, (client) =>
      client.accounts.rename({ params: key, payload: { label } }),
    ).pipe(
      Effect.tap((saved) => Effect.sync(() => acknowledgeAccount(get, key.organization, saved))),
    ),
  ),
);
/** A different account cannot supersede this account's rename request. */
export const renameAccountAtom = (key: {
  organization: OrganizationReference;
  account: AccountId;
}) => renameAccount(new AccountKey(key));
export const reconnectAccountAtom = HostedClient.mutation("accounts", "reconnect");
const disconnectAccount = Atom.family((key: AccountKey) =>
  HostedClient.runtime.fn((_: void, get) =>
    Effect.flatMap(HostedClient, (client) => client.accounts.disconnect({ params: key })).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          refreshCredentialDependents(get, key.organization, key.account);
          acknowledge(get, inventoryAtom(key.organization), (data) => ({
            ...data,
            accounts: data.accounts.filter((account) => account.id !== key.account),
          }));
          invalidate(get, accountAtom(key));
        }),
      ),
    ),
  ),
);
/** Remove only the confirmed account; unresolved app selections remain visible. */
export const disconnectAccountAtom = (key: {
  organization: OrganizationReference;
  account: AccountId;
}) => disconnectAccount(new AccountKey(key));

/** Save safe metadata without inventing credential health or changing app selections. */
export function acknowledgeAccount(
  get: Atom.FnContext,
  organization: OrganizationReference,
  saved: Account,
  credentialsChanged = false,
) {
  acknowledge(get, accountAtom({ organization, account: saved.id }), (data) => ({
    ...data,
    account: saved,
  }));
  acknowledge(get, inventoryAtom(organization), (data) => ({
    ...data,
    accounts: upsert(data.accounts, saved),
  }));
  if (credentialsChanged) refreshCredentialDependents(get, organization, saved.id);
}

function refreshCredentialDependents(
  get: Atom.FnContext,
  organization: OrganizationReference,
  account: AccountId,
) {
  const inventory = AsyncResult.value(get(inventoryAtom(organization)));
  if (Option.isSome(inventory))
    for (const app of inventory.value.apps) {
      if (
        Object.values(app.accounts).some((selection) =>
          typeof selection === "string" ? selection === account : selection.includes(account),
        )
      ) {
        get.refresh(appAtom({ organization, app: app.id }));
        get.refresh(toolsAtom({ organization, app: app.id }));
      }
    }
}
