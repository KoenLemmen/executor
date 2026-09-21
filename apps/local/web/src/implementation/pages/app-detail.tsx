import { useAtomSet } from "@effect/atom-react";
import type { App, AppId } from "@executor-js/sdk";
import type { DashboardOverview } from "@executor-js/local-server/contracts";
import { Option } from "effect";
import { QueryResult, useQuery } from "@executor-js/ui/dashboard/context";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft02Icon, ArrowUpRight01Icon, Delete02Icon } from "@hugeicons/core-free-icons";
import { appAtom } from "../../contracts/api.ts";
import { renameAppAtom } from "../../contracts/apps.ts";
import { Link, useNavigate } from "@tanstack/react-router";
import { Failure } from "../components/common.tsx";
import { Button } from "@executor-js/ui/components/button";
import type { DashboardError } from "../../contracts/errors.ts";
import { RenameApp } from "@executor-js/ui/dashboard/rename-app";
import { AppDetailLayout } from "@executor-js/ui/dashboard/app-detail";
import { ToolBrowserLoading } from "@executor-js/ui/dashboard/tools";
import { DetailSkeleton } from "@executor-js/ui/dashboard/loading";
import { AppTools } from "./app-tools.tsx";
import { AppAccounts } from "./app-accounts.tsx";
import { AppSource } from "./app-source.tsx";

type Tab = "tools" | "accounts" | "source";

/** Inspect a configured app without conflating its live tools with retained source versions. */
export function AppDetailPage({
  id,
  tab,
  tool,
  overview,
}: {
  readonly id: AppId;
  readonly tab: Tab;
  readonly tool: string | undefined;
  readonly overview: DashboardOverview;
}) {
  const navigate = useNavigate();
  const { result, data, refresh } = useQuery(appAtom(id));
  const app = Option.isSome(data) ? data.value.app : overview.apps.find((item) => item.id === id);
  return (
    <AppDetailLayout
      key={id}
      app={app}
      tab={tab}
      tabs={[
        { id: "tools", label: "Tools" },
        { id: "accounts", label: "Accounts" },
        { id: "source", label: "Source" },
      ]}
      onTabChange={(view) => {
        void navigate({ to: "/apps/$appId", params: { appId: id }, search: { view } });
      }}
      back={
        <Link
          className="back-link inline-flex gap-1.5 items-center text-[12px] text-muted-foreground mb-4.25 hover:text-foreground max-[740px]:min-h-11 max-[740px]:inline-flex max-[740px]:items-center max-[740px]:-mt-2 max-[740px]:mb-3"
          to="/apps"
        >
          <HugeiconsIcon icon={ArrowLeft02Icon} size={14} />
          Apps
        </Link>
      }
      actions={
        <>
          {Option.isSome(data) && data.value.uiUrl !== null && (
            <Button variant="outline" asChild>
              <a href={data.value.uiUrl} target="_blank" rel="noopener noreferrer">
                Open app{" "}
                <HugeiconsIcon icon={ArrowUpRight01Icon} strokeWidth={2} aria-hidden size={14} />
              </a>
            </Button>
          )}
          {Option.isSome(data) && data.value.canDelete && <AppRename app={data.value.app} />}
          {Option.isSome(data) && data.value.canDelete && (
            <Button variant="ghost" size="icon-sm" asChild>
              <Link
                to="/apps/$appId/delete"
                params={{ appId: id }}
                aria-label="Delete app"
                title="Delete app"
              >
                <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} aria-hidden size={15} />
              </Link>
            </Button>
          )}
        </>
      }
    >
      <QueryResult
        result={result}
        Failure={Failure}
        retry={refresh}
        pending={tab === "tools" ? <ToolBrowserLoading /> : <DetailSkeleton label="Loading app" />}
      >
        {(current) =>
          tab === "tools" ? (
            <AppTools app={current.app} accounts={overview.accounts} selected={tool} />
          ) : tab === "accounts" ? (
            <AppAccounts app={current.app} accounts={overview.accounts} />
          ) : (
            <AppSource data={current} />
          )
        }
      </QueryResult>
    </AppDetailLayout>
  );
}

/** Local reads update through their existing storage subscriptions. */
function AppRename({ app }: { readonly app: App }) {
  const rename = useAtomSet(renameAppAtom(app.id), { mode: "promiseExit" });
  return <RenameApp<DashboardError> app={app} Failure={Failure} rename={(name) => rename(name)} />;
}
