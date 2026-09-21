import type { AccountSubmission, OAuthSubmission } from "@executor-js/ui/contracts/credentials";
import { QueryView } from "@executor-js/ui/dashboard/context";
import { DetailSkeleton } from "@executor-js/ui/dashboard/loading";
import { useAtomSet } from "@effect/atom-react";
import { AccountConnectionId } from "@executor-js/sdk";
import type { HostedAccountConnection } from "@executor-js/hosted-server";
import { Link, useNavigate } from "@tanstack/react-router";
import { Cause, Match, Option } from "effect";
import { Button } from "@executor-js/ui/components/button";
import { OAuthFields } from "@executor-js/ui/dashboard/oauth-fields";
import { ProviderIcon } from "@executor-js/ui/dashboard/common";
import { providerDisplayUrl } from "@executor-js/ui/contracts/dashboard";
import { HostedFailure } from "../components/dashboard-bindings.tsx";
import { AccountForm } from "@executor-js/ui/dashboard/account-form";
import { connectionAtom, startOAuthAtom, submitConnectionAtom } from "../../contracts/apps.ts";
import { useOrganizationRoute } from "../components/organization.tsx";

/** Credentials go directly to the authorized host; saved values are never loaded into the form. */
export function ConnectAccountPage({ connectionId }: { readonly connectionId: string }) {
  const { organization } = useOrganizationRoute();
  return (
    <section className="page setup-page w-full shrink-0 [padding:24px_24px_48px] my-0 mx-auto max-[1000px]:[padding:20px_20px_40px] max-w-212.5 max-[740px]:[padding:18px_max(16px,_env(safe-area-inset-right))_max(32px,_env(safe-area-inset-bottom))_max(16px,_env(safe-area-inset-left))]">
      <QueryView
        query={connectionAtom({ organization, connection: AccountConnectionId.make(connectionId) })}
        Failure={HostedFailure}
        pending={<DetailSkeleton label="Loading account setup" />}
      >
        {(connection) => <ConnectionForm key={connectionId} connection={connection} />}
      </QueryView>
    </section>
  );
}
function ConnectionForm({ connection }: { readonly connection: HostedAccountConnection }) {
  const organization = useOrganizationRoute();
  const organizationSlug = organization.slug;
  const navigate = useNavigate();
  const submit = useAtomSet(
    submitConnectionAtom({ organization: organization.organization, connection: connection.id }),
    { mode: "promiseExit" },
  );
  const startOAuth = useAtomSet(startOAuthAtom, { mode: "promiseExit" });
  const params = { organization: organization.organization, connection: connection.id };
  const target = connection.target;
  if (connection.state.status !== "pending")
    return (
      <>
        <h1 className="text-[22px] font-semibold tracking-[-0.035em] leading-[1.35] [&>span]:text-muted-foreground [&>span]:text-[13px] [&>span]:font-mono [&>span]:font-normal [&>span]:ml-[8px] [&>span]:align-middle">
          {connection.state.status === "completed"
            ? "Account connected"
            : "This connection is no longer active"}
        </h1>
        <Button asChild className="mt-4 self-start">
          <Link to="/org/$organizationSlug/apps" params={{ organizationSlug }}>
            Apps
          </Link>
        </Button>
      </>
    );
  return (
    <>
      {connection.reconnectAccount && (
        <Link
          to="/org/$organizationSlug/accounts/$accountId"
          params={{ organizationSlug, accountId: connection.reconnectAccount.id }}
          className="back-link inline-flex gap-1.5 items-center text-[12px] text-muted-foreground mb-4.25 hover:text-foreground max-[740px]:min-h-11 max-[740px]:inline-flex max-[740px]:items-center max-[740px]:-mt-2 max-[740px]:mb-3"
        >
          ← Account
        </Link>
      )}
      {target && (
        <Link
          to="/org/$organizationSlug/apps/$appId"
          params={{ organizationSlug, appId: target.app }}
          className="muted text-muted-foreground"
        >
          ← {target.name}
        </Link>
      )}
      <div className="setup-provider mt-4 flex items-center gap-3.25 [&_h2]:text-[16px] [&_h2]:[font-weight:550] [&_>_div]:min-w-0 [&_>_div]:wrap-anywhere">
        <ProviderIcon
          name={connection.provider.definition.name}
          url={providerDisplayUrl(connection.provider.definition)}
          large
        />
        <h1 className="text-[22px] font-semibold tracking-[-0.035em] leading-[1.35] [&>span]:text-muted-foreground [&>span]:text-[13px] [&>span]:font-mono [&>span]:font-normal [&>span]:ml-[8px] [&>span]:align-middle">
          {connection.reconnectAccount ? "Reconnect" : "Connect"}{" "}
          {connection.provider.definition.name}
        </h1>
      </div>
      <AccountForm
        provider={connection.provider}
        {...(connection.reconnectAccount ? { account: connection.reconnectAccount } : {})}
        Failure={HostedFailure}
        submitLabel={connection.reconnectAccount ? "Save credentials" : "Connect account"}
        submit={(input: AccountSubmission) => submit(input)}
        onSaved={(account) => {
          void navigate(
            target
              ? {
                  to: "/org/$organizationSlug/apps/$appId",
                  params: { organizationSlug, appId: target.app },
                }
              : {
                  to: "/org/$organizationSlug/accounts/$accountId",
                  params: { organizationSlug, accountId: account.id },
                },
          );
        }}
        oauth={({ method, disabled, onPendingChange }) => (
          <OAuthFields
            providerName={connection.provider.definition.name}
            Failure={HostedFailure}
            disabled={disabled}
            {...(connection.reconnectAccount ? { account: connection.reconnectAccount } : {})}
            redirectUri={connection.redirectUri}
            onPendingChange={onPendingChange}
            requiresClient={(cause) =>
              Option.exists(Cause.findErrorOption(cause), (error) =>
                Match.value(error).pipe(
                  Match.tag("OAuthClientUnavailable", () => true),
                  Match.orElse(() => false),
                ),
              )
            }
            start={(input: OAuthSubmission) =>
              startOAuth({ params, payload: { method, ...input } })
            }
            onAuthorized={(value) => {
              sessionStorage.setItem(
                "executor:hosted:oauth",
                JSON.stringify({
                  organization: organization.organization,
                  organizationSlug,
                  connection: connection.id,
                  app: target?.app ?? null,
                  redirectUri: value.redirectUri,
                }),
              );
              window.location.assign(value.authorizationUrl);
            }}
          />
        )}
      />
    </>
  );
}
