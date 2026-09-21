import { DetailSkeleton } from "@executor-js/ui/dashboard/loading";
import { Exit } from "effect";
import { HostedFailure, useDashboardAtoms } from "../components/dashboard-bindings.tsx";
import { useAtomSet } from "@effect/atom-react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AppId } from "@executor-js/sdk";
import { AccountSelectionForm } from "@executor-js/ui/dashboard/account-selection";
import { QueryView } from "@executor-js/ui/dashboard/context";
import { Button } from "@executor-js/ui/components/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, ArrowLeft02Icon } from "@hugeicons/core-free-icons";
import { appAtom, connectAppAtom, appError } from "../../contracts/apps.ts";
import { useOrganizationRoute } from "../components/organization.tsx";

/** Membership governs the page; the shared form has no organization/role concepts. */
export function AccountSelectionPage({ appId }: { readonly appId: string }) {
  const { organization, role, slug: organizationSlug } = useOrganizationRoute();
  const atoms = useDashboardAtoms();
  const navigate = useNavigate();
  const app = AppId.make(appId);
  return (
    <div className="page setup-page w-full shrink-0 [padding:24px_24px_48px] my-0 mx-auto max-[1000px]:[padding:20px_20px_40px] max-w-212.5 max-[740px]:[padding:18px_max(16px,_env(safe-area-inset-right))_max(32px,_env(safe-area-inset-bottom))_max(16px,_env(safe-area-inset-left))]">
      <Link
        to="/org/$organizationSlug/apps/$appId"
        params={{ organizationSlug, appId }}
        search={{ view: "accounts" }}
        className="back-link inline-flex gap-1.5 items-center text-[12px] text-muted-foreground mb-4.25 hover:text-foreground max-[740px]:min-h-11 max-[740px]:inline-flex max-[740px]:items-center max-[740px]:-mt-2 max-[740px]:mb-3"
      >
        <HugeiconsIcon icon={ArrowLeft02Icon} size={14} />
        App
      </Link>
      {role === "member" ? (
        <p>An organization admin can change account selections.</p>
      ) : (
        <QueryView
          pending={<DetailSkeleton label="Loading account setup" />}
          Failure={HostedFailure}
          query={appAtom({ organization, app })}
        >
          {(app) => (
            <QueryView
              pending={<DetailSkeleton label="Loading account setup" />}
              Failure={HostedFailure}
              query={atoms.inventory}
            >
              {(inventory) => (
                <AccountSelectionForm
                  mutation={atoms.selectAccounts}
                  Failure={HostedFailure}
                  key={app.id}
                  app={app}
                  available={inventory.accounts}
                  connectAction={(requirement) => (
                    <ConnectAccount app={app.id} requirement={requirement} />
                  )}
                  finishAction={
                    <Link
                      to="/org/$organizationSlug/apps/$appId"
                      params={{ organizationSlug, appId }}
                      search={{ view: "accounts" }}
                    >
                      Finish later
                    </Link>
                  }
                  onSaved={() =>
                    navigate({
                      to: "/org/$organizationSlug/apps/$appId",
                      params: { organizationSlug, appId },
                      search: { view: "tools" },
                    })
                  }
                />
              )}
            </QueryView>
          )}
        </QueryView>
      )}
    </div>
  );
}
function ConnectAccount({
  app,
  requirement,
}: {
  readonly app: AppId;
  readonly requirement: string;
}) {
  const { organization, slug: organizationSlug } = useOrganizationRoute();
  const connect = useAtomSet(connectAppAtom, { mode: "promiseExit" });
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        className="add-inline flex items-center gap-1.75 text-[13px] w-[fit-content] max-[740px]:min-h-11 max-[740px]:inline-flex max-[740px]:items-center"
        loading={pending}
        onClick={async () => {
          setPending(true);
          setError(undefined);
          const result = await connect({ params: { organization, app }, payload: { requirement } });
          setPending(false);
          if (Exit.isFailure(result)) setError(appError(result.cause));
          else
            await navigate({
              to: "/org/$organizationSlug/connections/$connectionId",
              params: { organizationSlug, connectionId: result.value.id },
            });
        }}
      >
        <HugeiconsIcon icon={Add01Icon} size={14} />
        Add account
      </Button>
      {error && (
        <p role="alert" className="auth-error text-destructive text-[13px]">
          {error}
        </p>
      )}
    </>
  );
}
