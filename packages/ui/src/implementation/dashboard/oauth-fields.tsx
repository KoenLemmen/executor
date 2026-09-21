import { useState } from "react";
import { Exit, Redacted, type Cause } from "effect";
import type { Account } from "@executor-js/sdk";
import type { OAuthSubmission } from "../../contracts/credentials.ts";
import type { FailureProps } from "../../contracts/dashboard.ts";
import type { ComponentType } from "react";
import { Button } from "../components/button.tsx";
import { Input } from "../components/input.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/select.tsx";
import { CopyButton } from "./code.tsx";

/** Automatic OAuth setup and manual client entry; each host owns the sign-in and return flow. */
export function OAuthFields<A, E>({
  providerName,
  account,
  redirectUri,
  start,
  onAuthorized,
  requiresClient,
  Failure,
  onPendingChange,
  disabled = false,
}: {
  readonly providerName: string;
  readonly account?: Pick<Account, "label">;
  readonly redirectUri: string;
  readonly start: (input: OAuthSubmission) => Promise<Exit.Exit<A, E>>;
  readonly onAuthorized: (value: NoInfer<A>) => void;
  readonly requiresClient: (cause: Cause.Cause<NoInfer<E>>) => boolean;
  readonly Failure: ComponentType<FailureProps<NoInfer<E>>>;
  readonly disabled?: boolean;
  readonly onPendingChange?: (pending: boolean) => void;
}) {
  const [label, setLabel] = useState(account?.label ?? "Default");
  const [manual, setManual] = useState(false);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [authMethod, setAuthMethod] = useState<
    "none" | "client_secret_basic" | "client_secret_post"
  >("none");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Cause.Cause<E>>();
  const blocked =
    disabled ||
    pending ||
    !label.trim() ||
    (manual && (!clientId.trim() || (authMethod !== "none" && !clientSecret)));
  const connect = () => {
    if (blocked) return;
    setPending(true);
    onPendingChange?.(true);
    setError(undefined);
    const client = manual
      ? {
          clientId: clientId.trim(),
          tokenEndpointAuthMethod: authMethod,
          ...(authMethod === "none" ? {} : { clientSecret: Redacted.make(clientSecret) }),
        }
      : undefined;
    const operation = start({ label: label.trim(), ...(client ? { client } : {}) });
    void operation.then((exit) => {
      setPending(false);
      onPendingChange?.(false);
      if (Exit.isSuccess(exit)) {
        setClientSecret("");
        onAuthorized(exit.value);
      } else {
        if (requiresClient(exit.cause)) setManual(true);
        else setError(exit.cause);
      }
    });
  };
  return (
    <>
      {account === undefined && (
        <label className="field-label flex flex-col gap-2.25 text-[13px] font-medium [&_[data-slot='select-trigger']]:w-full">
          Account name
          <Input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            disabled={pending || disabled}
            maxLength={120}
          />
        </label>
      )}
      {manual && (
        <>
          <p className="field-hint text-muted-foreground text-[12px] font-normal leading-[1.5] [.mcp-install-content_>_&]:mt-5">
            This provider needs your OAuth client.
          </p>
          <div className="field-label flex flex-col gap-2.25 text-[13px] font-medium [&_[data-slot='select-trigger']]:w-full">
            <span>Redirect URL</span>
            <div className="oauth-redirect flex items-start gap-3 [&_>_code]:flex-1 [&_>_code]:min-w-0 [&_>_code]:py-[3px] [&_>_code]:px-0 [&_>_code]:font-mono [&_>_code]:text-[12px] [&_>_code]:font-normal [&_>_code]:wrap-anywhere [&_>_code]:[user-select:all]">
              <code>{redirectUri}</code>
              <CopyButton code={redirectUri} label="Copy redirect URL" inline />
            </div>
            <span className="field-hint text-muted-foreground text-[12px] font-normal leading-[1.5] [.mcp-install-content_>_&]:mt-5">
              Use this URL in your OAuth client settings.
            </span>
          </div>
          <label className="field-label flex flex-col gap-2.25 text-[13px] font-medium [&_[data-slot='select-trigger']]:w-full">
            Client ID
            <Input
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              disabled={pending || disabled}
              autoComplete="off"
            />
          </label>
          <label className="field-label flex flex-col gap-2.25 text-[13px] font-medium [&_[data-slot='select-trigger']]:w-full">
            Client authentication
            <Select
              value={authMethod}
              onValueChange={(value) => {
                if (
                  value === "none" ||
                  value === "client_secret_basic" ||
                  value === "client_secret_post"
                )
                  setAuthMethod(value);
              }}
              disabled={pending || disabled}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Public client (PKCE)</SelectItem>
                <SelectItem value="client_secret_basic">Client secret in header</SelectItem>
                <SelectItem value="client_secret_post">Client secret in body</SelectItem>
              </SelectContent>
            </Select>
          </label>
          {authMethod !== "none" && (
            <label className="field-label flex flex-col gap-2.25 text-[13px] font-medium [&_[data-slot='select-trigger']]:w-full">
              Client secret
              <Input
                type="password"
                autoComplete="off"
                value={clientSecret}
                onChange={(event) => setClientSecret(event.target.value)}
                disabled={pending || disabled}
              />
            </label>
          )}
        </>
      )}
      {error && <Failure cause={error} />}
      <div className="form-actions flex items-center gap-5 pt-1 text-[13px] [&_a]:text-muted-foreground max-[740px]:[&_>_a]:min-h-11 max-[740px]:[&_>_a]:inline-flex max-[740px]:[&_>_a]:items-center max-[740px]:flex-wrap max-[740px]:gap-[12px_20px] max-[480px]:[&_>_button]:basis-full">
        <Button type="button" disabled={blocked} onClick={connect}>
          {pending
            ? "Preparing sign-in…"
            : `${account === undefined ? "Connect" : "Reconnect"} ${providerName}`}
        </Button>
      </div>
      <Button
        type="button"
        variant="ghost"
        disabled={pending || disabled}
        onClick={() => {
          setManual(!manual);
          setError(undefined);
        }}
      >
        {manual ? "Use automatic setup" : "Use your own OAuth client"}
      </Button>
    </>
  );
}
