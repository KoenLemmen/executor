import { DetailSkeleton } from "@executor-js/ui/dashboard/loading";
import { Exit, Option } from "effect";
import { HostedFailure, useDashboardAtoms } from "../components/dashboard-bindings.tsx";
import { useAtomSet } from "@effect/atom-react";
import { AppId, type App } from "@executor-js/sdk";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft02Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { Button } from "@executor-js/ui/components/button";
import type { HostedError } from "../../contracts/errors.ts";
import { RenameApp } from "@executor-js/ui/dashboard/rename-app";
import { AppDetailLayout } from "@executor-js/ui/dashboard/app-detail";
import { AppAccounts } from "@executor-js/ui/dashboard/app-accounts";
import { QueryResult, useQuery } from "@executor-js/ui/dashboard/context";
import { appAtom, appError, removeAppAtom, renameAppAtom } from "../../contracts/apps.ts";
import { useOrganizationRoute } from "../components/organization.tsx";
import { ToolBrowserLoading } from "@executor-js/ui/dashboard/tools";
import { AppTools } from "./app-tools.tsx";
import { AppSource } from "./app-source.tsx";

/** Host routing and permissions surround the common local detail frame. */
export function AppDetailPage({
  appId,
  view = "tools",
  tool,
  openApp,
}: {
  readonly appId: string;
  readonly view?: "tools" | "accounts" | "source" | undefined;
  readonly tool?: string | undefined;
  readonly openApp?: (app: App) => ReactNode;
}) {
  const { organization, role, slug: organizationSlug } = useOrganizationRoute();
  const atoms = useDashboardAtoms();
  const inventory = useQuery(atoms.inventory);
  const { result, data, refresh } = useQuery(appAtom({ organization, app: AppId.make(appId) }));
  const app = Option.isSome(data)
    ? data.value
    : Option.isSome(inventory.data)
      ? inventory.data.value.apps.find((item) => item.id === appId)
      : undefined;
  const pending =
    view === "tools" ? (
      <ToolBrowserLoading label="Loading app" />
    ) : (
      <DetailSkeleton label="Loading app" />
    );
  const navigate = useNavigate();
  return (
    <AppDetailLayout
      key={appId}
      app={app}
      tab={view}
      tabs={[
        { id: "tools", label: "Tools" },
        { id: "accounts", label: "Accounts" },
        ...(role === "owner" || role === "admin"
          ? [{ id: "source" as const, label: "Source" }]
          : []),
      ]}
      onTabChange={(view) => {
        void navigate({
          to: "/org/$organizationSlug/apps/$appId",
          params: { organizationSlug, appId },
          search: { view },
        });
      }}
      back={
        <Link
          to="/org/$organizationSlug/apps"
          params={{ organizationSlug }}
          className="back-link inline-flex gap-1.5 items-center text-[12px] text-muted-foreground mb-4.25 hover:text-foreground max-[740px]:min-h-11 max-[740px]:inline-flex max-[740px]:items-center max-[740px]:-mt-2 max-[740px]:mb-3"
        >
          <HugeiconsIcon icon={ArrowLeft02Icon} size={14} />
          Apps
        </Link>
      }
      actions={
        app && (
          <>
            {openApp?.(app)}
            {(role === "owner" || role === "admin") && (
              <>
                <AppRename app={app} />
                <DeleteApp app={app} />
              </>
            )}
          </>
        )
      }
    >
      <QueryResult result={result} Failure={HostedFailure} retry={refresh} pending={pending}>
        {(app) =>
          view === "source" ? (
            role === undefined ? (
              <DetailSkeleton label="Loading source access" />
            ) : role === "member" ? (
              <p>Only organization admins can inspect app source.</p>
            ) : (
              <AppSource key={app.id} app={app} />
            )
          ) : (
            <QueryResult
              pending={pending}
              Failure={HostedFailure}
              result={inventory.result}
              retry={inventory.refresh}
            >
              {(inventory) =>
                view === "tools" ? (
                  <AppTools app={app} accounts={inventory.accounts} selected={tool} />
                ) : (
                  <AppAccounts
                    app={app}
                    accounts={inventory.accounts}
                    chooseAction={
                      (role === "owner" || role === "admin") && (
                        <Button variant="outline" size="sm" asChild>
                          <Link
                            to="/org/$organizationSlug/apps/$appId/setup"
                            params={{ organizationSlug, appId }}
                          >
                            Choose accounts
                          </Link>
                        </Button>
                      )
                    }
                  />
                )
              }
            </QueryResult>
          )
        }
      </QueryResult>
    </AppDetailLayout>
  );
}
function DeleteApp({ app }: { readonly app: App }) {
  const { organization, slug: organizationSlug } = useOrganizationRoute();
  const remove = useAtomSet(removeAppAtom({ organization, app: app.id }), { mode: "promiseExit" });
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  return confirm ? (
    <div className="delete-confirm max-w-85 text-[13px] [&_.form-actions]:mt-2.5">
      <p>Delete {app.name}? Saved accounts are kept.</p>
      <div className="form-actions flex items-center gap-5 pt-1 text-[13px] [&_a]:text-muted-foreground max-[740px]:[&_>_a]:min-h-11 max-[740px]:[&_>_a]:inline-flex max-[740px]:[&_>_a]:items-center max-[740px]:flex-wrap max-[740px]:gap-[12px_20px]">
        <Button
          variant="destructive"
          loading={pending}
          onClick={async () => {
            setPending(true);
            const result = await remove();
            setPending(false);
            if (Exit.isFailure(result)) setError(appError(result.cause));
            else {
              await navigate({ to: "/org/$organizationSlug/apps", params: { organizationSlug } });
            }
          }}
        >
          Delete
        </Button>
        <Button variant="outline" onClick={() => setConfirm(false)}>
          Cancel
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
    </div>
  ) : (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Delete app"
      title="Delete app"
      onClick={() => setConfirm(true)}
    >
      <HugeiconsIcon icon={Delete02Icon} size={15} />
    </Button>
  );
}

/** The mutation acknowledges shared metadata before the dialog closes. */
function AppRename({ app }: { readonly app: App }) {
  const { organization } = useOrganizationRoute();
  const rename = useAtomSet(renameAppAtom({ organization, app: app.id }), { mode: "promiseExit" });
  return <RenameApp<HostedError> app={app} Failure={HostedFailure} rename={rename} />;
}
