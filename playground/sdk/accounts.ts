/** Selecting existing accounts never copies their credentials or transfers ownership. */
import { type AccountId, type AppId, type Executor, type OwnerId } from "@executor-js/sdk";

/** List reusable accounts whose provider definition matches an app requirement. */
export async function listAxiomAccounts(executor: Executor, appId: AppId, owner: OwnerId) {
  const app = await executor.apps.get({ app: appId });
  const axiom = app.requirements.accounts.axiom;
  if (axiom === undefined) throw new Error("This app must declare an axiom account");
  return executor.accounts.list({ owner, provider: axiom.provider });
}

/** After product authorization, two apps can select the exact same saved account. */
export async function reuseAxiomAccount(
  executor: Executor,
  firstApp: AppId,
  secondApp: AppId,
  selectedAccount: AccountId,
) {
  await executor.apps.update({ app: firstApp, accounts: { axiom: selectedAccount } });
  await executor.apps.update({ app: secondApp, accounts: { axiom: selectedAccount } });
}

/** One configured Mail app selects several accounts for its gmail.many() requirement. */
export async function selectMailboxes(
  executor: Executor,
  mailApp: AppId,
  work: AccountId,
  personal: AccountId,
) {
  return executor.apps.update({
    app: mailApp,
    accounts: { mailboxes: [work, personal] },
  });
}
