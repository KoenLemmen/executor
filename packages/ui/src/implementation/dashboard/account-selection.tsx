import { Exit } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useState, type ReactNode } from "react";
import type { App, AccountRequirement, SelectedAccounts } from "@executor-js/sdk";
import {
  providerDisplayUrl,
  type AccountSummary,
  type MutationProps,
  type SelectAccounts,
} from "../../contracts/dashboard.ts";
import { Empty, ProviderIcon } from "./common.tsx";
import { Button } from "../components/button.tsx";
import { Checkbox } from "../components/checkbox.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/select.tsx";

/** Draft a selection once; the product supplies connect actions and the save resolver. */
export function AccountSelectionForm<E>({
  mutation,
  Failure,
  app,
  available,
  initialAccounts,
  notice,
  connectAction,
  finishAction,
  onSaved,
}: MutationProps<SelectAccounts, App, E> & {
  readonly app: App;
  readonly available: readonly AccountSummary[];
  readonly initialAccounts?: SelectedAccounts;
  readonly notice?: ReactNode;
  readonly connectAction: (slot: string, requirement: AccountRequirement) => ReactNode;
  readonly finishAction: ReactNode;
  readonly onSaved: () => void | Promise<void>;
}) {
  const [draftAccounts, setAccounts] = useState<SelectedAccounts>();
  const accounts = draftAccounts ?? initialAccounts ?? app.accounts;
  const [pending, setPending] = useState(false);
  const result = useAtomValue(mutation);
  const save = useAtomSet(mutation, { mode: "promiseExit" });
  const requirements = Object.entries(app.requirements.accounts);
  const valid = requirements.every(([slot, requirement]) => {
    const selection = accounts[slot];
    if (selection === undefined) return true;
    const ids = typeof selection === "string" ? [selection] : selection;
    return (
      (requirement.cardinality === "one"
        ? typeof selection === "string"
        : typeof selection !== "string") &&
      ids.every((id) =>
        available.some((account) => account.id === id && account.provider === requirement.provider),
      )
    );
  });
  const clear = (slot: string) =>
    setAccounts(Object.fromEntries(Object.entries(accounts).filter(([name]) => name !== slot)));
  return (
    <>
      <div className="page-heading gap-4 flex justify-between items-center min-h-12 mb-4.5 [&_p]:text-muted-foreground [&_p]:text-[13px] [&_p]:mt-1.25 [&_>_div]:min-w-0 [&_>_div]:wrap-anywhere max-[740px]:items-start max-[740px]:mb-4.5 max-[740px]:[&_p]:leading-[1.6] max-[740px]:[&_>_[data-slot='button']]:mt-0.25 max-[740px]:[.setup-page_&]:min-h-0">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.035em] leading-[1.35] [&>span]:text-muted-foreground [&>span]:text-[13px] [&>span]:font-mono [&>span]:font-normal [&>span]:ml-[8px] [&>span]:align-middle">
            {app.name}
          </h1>
          <p>Choose the accounts this app will use.</p>
        </div>
      </div>
      {notice}
      <form
        className="setup-form max-w-145 flex flex-col gap-5.75 pt-2.5 max-[740px]:gap-5.25"
        onSubmit={(event) => {
          event.preventDefault();
          if (pending || !valid) return;
          setPending(true);
          void save({ app: app.id, accounts }).then((exit) => {
            setPending(false);
            if (Exit.isSuccess(exit)) {
              void onSaved();
            }
          });
        }}
      >
        {requirements.length === 0 ? (
          <Empty title="No account required">This app is ready to use.</Empty>
        ) : (
          requirements.map(([slot, requirement]) => {
            const options = available.filter(
              (account) => account.provider === requirement.provider,
            );
            const selection = accounts[slot];
            const selectedIds = typeof selection === "string" ? [selection] : (selection ?? []);
            return (
              <section
                className="selection-slot flex flex-col gap-4.25 pb-5.5 border-b border-b-border [&_[data-slot='select-trigger']]:w-full"
                key={slot}
              >
                <div className="setup-provider flex items-center gap-3.25 [&_h2]:text-[16px] [&_h2]:[font-weight:550] [&_>_div]:min-w-0 [&_>_div]:wrap-anywhere">
                  <ProviderIcon
                    name={requirement.definition.name}
                    url={providerDisplayUrl(requirement.definition)}
                  />
                  <div>
                    <h2>{requirement.definition.name}</h2>
                    {requirements.length > 1 && (
                      <code className="row-meta flex flex-wrap gap-1.5 items-center mt-0.75 text-[11px] text-muted-foreground">
                        {slot}
                      </code>
                    )}
                  </div>
                </div>
                {requirement.cardinality === "one" ? (
                  <Select
                    value={typeof selection === "string" ? selection : "unselected"}
                    onValueChange={(value) => {
                      if (value === "unselected") {
                        clear(slot);
                        return;
                      }
                      const account = options.find((option) => option.id === value);
                      if (account) setAccounts({ ...accounts, [slot]: account.id });
                    }}
                    disabled={pending}
                  >
                    <SelectTrigger aria-label={`${requirement.definition.name} account`}>
                      <SelectValue
                        placeholder={options.length ? "Choose an account" : "No accounts connected"}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unselected">No account selected</SelectItem>
                      {typeof selection === "string" &&
                        !options.some((account) => account.id === selection) && (
                          <SelectItem value={selection} disabled>
                            {available.some((account) => account.id === selection)
                              ? "Account no longer compatible"
                              : "Account disconnected"}
                          </SelectItem>
                        )}
                      {options.map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                          {account.label || "Unnamed account"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="selection-many flex flex-col gap-3.5 [&_label]:flex [&_label]:items-center [&_label]:gap-2.5 [&_label]:text-[13px] max-[740px]:gap-1 max-[740px]:[&_label]:min-h-11 max-[740px]:[&_label]:wrap-anywhere max-[740px]:[&_[data-slot='checkbox']]:w-5 max-[740px]:[&_[data-slot='checkbox']]:h-5">
                    {options.map((account) => (
                      <label key={account.id}>
                        <Checkbox
                          checked={selectedIds.includes(account.id)}
                          disabled={pending}
                          onCheckedChange={(checked) =>
                            setAccounts({
                              ...accounts,
                              [slot]:
                                checked === true
                                  ? [...selectedIds, account.id]
                                  : selectedIds.filter((id) => id !== account.id),
                            })
                          }
                        />
                        {account.label || "Unnamed account"}
                      </label>
                    ))}
                    <label>
                      <Checkbox
                        checked={Array.isArray(selection) && !selection.length}
                        disabled={pending}
                        onCheckedChange={(checked) => {
                          if (checked === true) setAccounts({ ...accounts, [slot]: [] });
                        }}
                      />
                      Use without accounts
                    </label>
                  </div>
                )}
                {selectedIds.some((id) => !options.some((account) => account.id === id)) && (
                  <p className="field-hint text-muted-foreground text-[12px] font-normal leading-[1.5] [.mcp-install-content_>_&]:mt-5">
                    A selected account is unavailable. Choose another account or clear this
                    selection.
                  </p>
                )}
                {selection !== undefined && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="clear-selection self-start"
                    disabled={pending}
                    onClick={() => clear(slot)}
                  >
                    Clear selection
                  </Button>
                )}
                {selection === undefined && (
                  <p className="field-hint text-muted-foreground text-[12px] font-normal leading-[1.5] [.mcp-install-content_>_&]:mt-5">
                    This app needs a selection before it can run.
                  </p>
                )}
                {connectAction(slot, requirement)}
              </section>
            );
          })
        )}
        {AsyncResult.isFailure(result) && <Failure cause={result.cause} />}
        {!valid && (
          <span className="field-hint text-muted-foreground text-[12px] font-normal leading-[1.5] [.mcp-install-content_>_&]:mt-5">
            Clear or replace unavailable selections before saving.
          </span>
        )}
        <span className="field-hint text-muted-foreground text-[12px] font-normal leading-[1.5] [.mcp-install-content_>_&]:mt-5">
          Clearing a selection keeps the saved account.
        </span>
        <div className="form-actions flex items-center gap-5 pt-1 text-[13px] [&_a]:text-muted-foreground max-[740px]:[&_>_a]:min-h-11 max-[740px]:[&_>_a]:inline-flex max-[740px]:[&_>_a]:items-center max-[740px]:flex-wrap max-[740px]:gap-[12px_20px] max-[480px]:[&_>_button]:basis-full">
          <Button disabled={pending || !valid} type="submit">
            {pending ? "Saving…" : "Save selection"}
          </Button>
          {finishAction}
        </div>
      </form>
    </>
  );
}
