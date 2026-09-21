import { QueryView } from "@executor-js/ui/dashboard/context";
import { dashboardAtoms } from "../../contracts/dashboard-bindings.ts";
import { AccountSelectionForm } from "@executor-js/ui/dashboard/account-selection";
import type { App, AppId, SelectedAccounts } from "@executor-js/sdk";
import type { DashboardOverview } from "@executor-js/local-server/contracts";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, ArrowLeft02Icon } from "@hugeicons/core-free-icons";
import { appAtom } from "../../contracts/api.ts";
import type { SetupSearch } from "../../contracts/navigation.ts";
import { Link, useNavigate } from "@tanstack/react-router";
import { Failure, LoadingRows } from "../components/common.tsx";

/** Full-page selection is separate from saving credentials, and can safely be retried. */
export function AccountSelectionPage({
  id,
  data,
  selected,
  slot,
}: { readonly id: AppId; readonly data: DashboardOverview } & SetupSearch) {
  return (
    <div className="page setup-page w-full shrink-0 [padding:24px_24px_48px] my-0 mx-auto max-[1000px]:[padding:20px_20px_40px] max-w-212.5 max-[740px]:[padding:18px_max(16px,_env(safe-area-inset-right))_max(32px,_env(safe-area-inset-bottom))_max(16px,_env(safe-area-inset-left))]">
      <Link
        className="back-link inline-flex gap-1.5 items-center text-[12px] text-muted-foreground mb-4.25 hover:text-foreground max-[740px]:min-h-11 max-[740px]:inline-flex max-[740px]:items-center max-[740px]:-mt-2 max-[740px]:mb-3"
        to="/apps/$appId"
        params={{ appId: id }}
        search={{ view: "accounts" }}
      >
        <HugeiconsIcon icon={ArrowLeft02Icon} strokeWidth={2} aria-hidden size={14} />
        App
      </Link>
      <QueryView key={id} query={appAtom(id)} Failure={Failure} pending={<LoadingRows />}>
        {(snapshot) => (
          <SelectionForm
            key={`${id}:${selected ?? ""}`}
            app={snapshot.app}
            data={data}
            {...(selected ? { selected } : {})}
            {...(slot ? { slot } : {})}
          />
        )}
      </QueryView>
    </div>
  );
}
function SelectionForm({
  app,
  data,
  selected,
  slot,
}: { readonly app: App; readonly data: DashboardOverview } & SetupSearch) {
  const navigate = useNavigate();
  let initial: SelectedAccounts = { ...app.accounts };
  if (selected && slot && app.requirements.accounts[slot]) {
    const requirement = app.requirements.accounts[slot];
    const previous = initial[slot];
    initial = {
      ...initial,
      [slot]:
        requirement.cardinality === "many"
          ? [...new Set([...(Array.isArray(previous) ? previous : []), selected])]
          : selected,
    };
  }
  return (
    <AccountSelectionForm
      mutation={dashboardAtoms.selectAccounts}
      Failure={Failure}
      app={app}
      available={data.accounts}
      initialAccounts={initial}
      notice={
        selected && (
          <div className="setup-notice py-[12px] px-[14px] border border-border rounded-[7px] text-muted-foreground bg-muted text-[13px] my-[8px] mx-0">
            Account saved. Save the selection to finish.
          </div>
        )
      }
      connectAction={(slot, requirement) => (
        <Link
          className="add-inline flex items-center gap-1.75 text-[13px] w-[fit-content] max-[740px]:min-h-11 max-[740px]:inline-flex max-[740px]:items-center"
          to="/accounts/add"
          search={{ provider: requirement.provider, app: app.id, slot }}
        >
          <HugeiconsIcon icon={Add01Icon} size={14} />
          Add account
        </Link>
      )}
      finishAction={
        <Link to="/apps/$appId" params={{ appId: app.id }} search={{ view: "accounts" }}>
          Finish later
        </Link>
      }
      onSaved={() =>
        navigate({ to: "/apps/$appId", params: { appId: app.id }, search: { view: "tools" } })
      }
    />
  );
}
