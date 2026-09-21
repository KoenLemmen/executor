import type {
  AppId,
  AccountConnectionId,
  Executor,
  OwnerId,
  SelectedAccounts,
} from "@executor-js/sdk/core";
import { Effect } from "effect";
import { CurrentOrganization, OrganizationForbidden } from "../contracts/organization.ts";

/** Membership was checked by middleware; administrative actions require the current role. */
export const requireOrganizationAdmin = Effect.gen(function* () {
  const organization = yield* CurrentOrganization;
  if (organization.role === "member") return yield* new OrganizationForbidden();
  return organization;
});
/** Only an owner may remove the organization itself. */
export const requireOrganizationOwner = Effect.gen(function* () {
  const organization = yield* CurrentOrganization;
  if (organization.role !== "owner") return yield* new OrganizationForbidden();
  return organization;
});
/** Server-derived owners are the only owners used by hosted HTTP handlers. */
export const currentOwner = Effect.map(CurrentOrganization, (organization) => organization.owner);
/** Resolve administrative authority before opening the SDK or performing work. */
export const adminOwner = Effect.map(
  requireOrganizationAdmin,
  (organization) => organization.owner,
);

/** The first hosted policy permits organization accounts only; the SDK itself permits cross-owner use. */
export const checkAccounts = (executor: Executor, owner: OwnerId, accounts: SelectedAccounts) =>
  Effect.gen(function* () {
    for (const selection of Object.values(accounts)) {
      for (const account of typeof selection === "string" ? [selection] : selection)
        yield* executor.accounts.get({ owner, account });
    }
  });
/** Check both the configured app and every selected account before evaluating its code. */
export const selectedApp = (executor: Executor, owner: OwnerId, app: AppId) =>
  Effect.gen(function* () {
    const current = yield* executor.apps.get({ owner, app });
    yield* checkAccounts(executor, owner, current.accounts);
    return current;
  });
/** A connection must still belong to this organization, along with its optional target app. */
export const ownedConnection = (
  executor: Executor,
  owner: OwnerId,
  connection: AccountConnectionId,
) =>
  Effect.gen(function* () {
    const current = yield* executor.accountConnections.get({ owner, connection });
    if (current.target !== null) yield* executor.apps.get({ owner, app: current.target.app });
    return current;
  });
