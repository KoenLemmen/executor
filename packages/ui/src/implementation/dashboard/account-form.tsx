import { useState, type ComponentType, type ReactNode } from "react";
import { Exit, Option, Redacted, type Cause } from "effect";
import type { Account, Provider } from "@executor-js/sdk";
import type { FailureProps } from "../../contracts/dashboard.ts";
import {
  accountFields,
  credentialsComplete,
  credentialValues,
  type AccountSubmission,
  type AccountOAuthProps,
} from "../../contracts/credentials.ts";
import { CredentialFields } from "../components/credential-fields.tsx";
import { Button } from "../components/button.tsx";
import { Input } from "../components/input.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/select.tsx";

/** One credential form for creation, reconnection and agent handoff; the host owns saving and navigation. */
export function AccountForm<A, E>({
  provider,
  account,
  header,
  actions,
  submitLabel,
  submit,
  onSaved,
  oauth,
  Failure,
  onPendingChange,
  disabled = false,
}: {
  readonly provider: Provider;
  readonly account?: Pick<Account, "method" | "label">;
  readonly header?: ReactNode;
  readonly actions?: ReactNode;
  readonly submitLabel: string;
  readonly submit: (input: AccountSubmission) => Promise<Exit.Exit<A, E>>;
  readonly onSaved: (value: NoInfer<A>) => void;
  readonly oauth: (props: AccountOAuthProps) => ReactNode;
  readonly Failure: ComponentType<FailureProps<NoInfer<E>>>;
  readonly disabled?: boolean;
  readonly onPendingChange?: (pending: boolean) => void;
}) {
  const methods = Object.entries(provider.definition.auth).sort(
    ([, a], [, b]) => Number(b.type === "oauth2") - Number(a.type === "oauth2"),
  );
  const [method, setMethod] = useState(account?.method ?? methods[0]?.[0] ?? "");
  const [label, setLabel] = useState(account?.label ?? "Default");
  const [values, setValues] = useState<Readonly<Record<string, string>>>({});
  const [submitting, setPending] = useState(false);
  const pending = submitting || disabled;
  const [error, setError] = useState<Cause.Cause<E>>();
  const auth = provider.definition.auth[method];
  const parsed = auth && accountFields(auth);
  const fields = parsed && Option.isSome(parsed) ? parsed.value : undefined;
  const updatePending = (value: boolean) => {
    setPending(value);
    onPendingChange?.(value);
  };
  return (
    <form
      className="setup-form max-w-145 flex flex-col gap-5.75 pt-2.5 max-[740px]:gap-5.25"
      onSubmit={(event) => {
        event.preventDefault();
        if (!fields || pending || !label.trim() || !credentialsComplete(fields, values)) return;
        updatePending(true);
        setError(undefined);
        void submit({
          method,
          label: label.trim(),
          fields: Redacted.make(credentialValues(fields, values)),
        }).then((exit) => {
          updatePending(false);
          if (Exit.isFailure(exit)) setError(exit.cause);
          else {
            setValues({});
            onSaved(exit.value);
          }
        });
      }}
    >
      {header}
      {!account && methods.length > 1 && (
        <label className="field-label flex flex-col gap-2.25 text-[13px] font-medium [&_[data-slot='select-trigger']]:w-full">
          Sign-in method
          <Select
            value={method}
            disabled={pending}
            onValueChange={(value) => {
              setMethod(value);
              setValues({});
              setError(undefined);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {methods.map(([name, auth]) => (
                <SelectItem key={name} value={name}>
                  {auth.type === "oauth2" ? "OAuth" : auth.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      )}
      {auth?.type === "oauth2" ? (
        <div key={method} className="oauth-fields flex flex-col gap-4">
          {oauth({ method, disabled, onPendingChange: updatePending })}
        </div>
      ) : fields ? (
        <>
          {!account && (
            <label className="field-label flex flex-col gap-2.25 text-[13px] font-medium [&_[data-slot='select-trigger']]:w-full">
              Account name
              <Input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="Default"
                required
                maxLength={120}
                disabled={pending}
              />
            </label>
          )}
          <CredentialFields
            fields={fields}
            values={values}
            onChange={setValues}
            pending={pending}
          />
          {error && <Failure cause={error} />}
          <div className="form-actions flex items-center gap-5 pt-1 text-[13px] [&_a]:text-muted-foreground max-[740px]:[&_>_a]:min-h-11 max-[740px]:[&_>_a]:inline-flex max-[740px]:[&_>_a]:items-center max-[740px]:flex-wrap max-[740px]:gap-[12px_20px] max-[480px]:[&_>_button]:basis-full">
            <Button type="submit" loading={pending} disabled={!label.trim()}>
              {submitLabel}
            </Button>
            {actions}
          </div>
        </>
      ) : (
        <p className="setup-notice py-[12px] px-[14px] border border-border rounded-[7px] text-muted-foreground bg-muted text-[13px] my-[8px] mx-0">
          This provider needs a custom credential form.
        </p>
      )}
    </form>
  );
}
