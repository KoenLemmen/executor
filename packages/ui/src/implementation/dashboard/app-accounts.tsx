import type { ReactNode } from "react";
import { useDashboard } from "./context.tsx";
import type { App } from "@executor-js/sdk";
import { providerDisplayUrl, type AccountSummary } from "../../contracts/dashboard.ts";
import { HugeiconsIcon } from "@hugeicons/react";
import { AlertCircleIcon, Key01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { accountSelectionIssues, accountNeedsSignIn } from "../../contracts/dashboard.ts";
import { Empty, ProviderIcon, SectionHeading } from "./common.tsx";

/** Inspect each declared account slot and its saved selection without changing it. */
export function AppAccounts({
  app,
  accounts,
  chooseAction,
  reconnectAction,
}: {
  readonly app: App;
  readonly accounts: readonly AccountSummary[];
  readonly chooseAction?: ReactNode;
  readonly reconnectAction?: (account: AccountSummary) => ReactNode;
}) {
  const { AccountLink } = useDashboard();
  const requirements = Object.entries(app.requirements.accounts);
  const issues = accountSelectionIssues(app, accounts);
  return (
    <div className="accounts-section">
      <div className="section-toolbar flex items-center justify-between mb-4.5 max-[740px]:gap-3 max-[740px]:flex-wrap">
        <SectionHeading>Selected accounts</SectionHeading>
        {chooseAction}
      </div>
      {requirements.length === 0 ? (
        <Empty title="No accounts required">This app can run without a saved account.</Empty>
      ) : (
        <div className="requirements-list max-w-185 border border-border rounded-[8px] overflow-hidden">
          {requirements.map(([slot, requirement]) => {
            const selection = app.accounts[slot];
            const ids =
              selection === undefined
                ? []
                : typeof selection === "string"
                  ? [selection]
                  : selection;
            return (
              <section
                className="requirement [.requirement_+_&]:border-t [.requirement_+_&]:border-t-border"
                key={slot}
              >
                <div className="requirement-heading p-[17px] flex items-center gap-2.75 bg-muted [&_>_div]:flex-1 [&_h3]:text-[13px] [&_h3]:font-medium [&_>_div]:min-w-0 [&_>_div]:wrap-anywhere">
                  <ProviderIcon
                    name={requirement.definition.name}
                    url={providerDisplayUrl(requirement.definition)}
                  />
                  <div>
                    <h3>{requirement.definition.name}</h3>
                    <span className="row-meta flex flex-wrap gap-1.5 items-center mt-0.75 text-[11px] text-muted-foreground">
                      {requirements.length > 1 && (
                        <>
                          <code>{slot}</code>
                          <span>·</span>
                        </>
                      )}
                      <span>
                        {requirement.cardinality === "many" ? "Multiple accounts" : "One account"}
                      </span>
                    </span>
                  </div>
                  {!issues.some((issue) => issue.slot === slot) &&
                    ids.every((id) =>
                      accounts.some(
                        (account) =>
                          account.id === id &&
                          !accountNeedsSignIn(account) &&
                          account.signIn?.state !== "unavailable",
                      ),
                    ) && (
                      <HugeiconsIcon
                        icon={Tick02Icon}
                        strokeWidth={2}
                        aria-hidden
                        size={15}
                        className="muted text-muted-foreground"
                      />
                    )}
                </div>
                <div className="selected-accounts py-0 px-[17px]">
                  {ids.map((id) => {
                    const account = accounts.find((item) => item.id === id);
                    return (
                      <div
                        className="selected-account [&_>_[data-slot='button']]:ml-auto [&_>_[data-slot='button']]:shrink-0 flex gap-2.5 items-start py-[17px] px-0 [.selected-account_+_&]:border-t [.selected-account_+_&]:border-t-border [&_>_svg]:mt-0.75 [&_>_svg]:text-muted-foreground [&_strong]:text-[13px] [&_strong]:font-medium [&_>_div]:min-w-0 [&_>_div]:wrap-anywhere [&_>_svg]:shrink-0 max-[740px]:flex-wrap"
                        key={id}
                      >
                        {account &&
                        !accountNeedsSignIn(account) &&
                        account.signIn?.state !== "unavailable" ? (
                          <HugeiconsIcon icon={Key01Icon} strokeWidth={2} aria-hidden size={14} />
                        ) : (
                          <HugeiconsIcon
                            icon={AlertCircleIcon}
                            strokeWidth={2}
                            aria-hidden
                            size={14}
                          />
                        )}
                        <div>
                          <strong>
                            {account ? (
                              <AccountLink account={account.id}>
                                {account.label || "Unnamed account"}
                              </AccountLink>
                            ) : (
                              "Account disconnected"
                            )}
                          </strong>
                          {account && (
                            <div className="row-meta flex flex-wrap gap-1.5 items-center mt-0.75 text-[11px] text-muted-foreground">
                              {accountNeedsSignIn(account) ? (
                                <span className="sign-in-status text-sign-in-warning text-[11px] font-medium whitespace-nowrap [.app-account-setup_h2_&]:ml-2">
                                  Needs sign-in
                                </span>
                              ) : account.signIn?.state === "unavailable" ? (
                                "Account unavailable"
                              ) : (
                                account.method
                              )}
                            </div>
                          )}
                        </div>
                        {!account && chooseAction}
                        {account && accountNeedsSignIn(account) && reconnectAction?.(account)}
                      </div>
                    );
                  })}
                  {ids.length === 0 && (
                    <div className="unselected py-[18px] px-0 text-[12px] text-muted-foreground">
                      {issues.some((issue) => issue.slot === slot)
                        ? "No account selected."
                        : "No accounts selected."}
                    </div>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
