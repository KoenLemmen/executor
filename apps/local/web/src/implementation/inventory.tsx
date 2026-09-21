import { useAtomValue } from "@effect/atom-react";
import type { DashboardOverview } from "@executor-js/local-server/contracts";
import { Outlet, useMatches } from "@tanstack/react-router";
import { Option } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { createContext, useContext } from "react";
import { overviewAtom } from "../contracts/api.ts";
import { LoadingRows } from "./components/common.tsx";

const OverviewContext = createContext<DashboardOverview | undefined>(undefined);

/** Mount inventory consumers only after authenticated overview data is available. */
export function InventoryLayout() {
  const result = useAtomValue(overviewAtom);
  const data = AsyncResult.value(result);
  const section = useMatches({ select: (matches) => matches.at(-1)?.staticData.section });
  if (Option.isSome(data))
    return (
      <OverviewContext value={data.value}>
        <Outlet />
      </OverviewContext>
    );
  if (AsyncResult.isFailure(result)) return null;
  return (
    <div className="page w-full shrink-0 max-w-315 [padding:24px_24px_48px] my-0 mx-auto max-[1000px]:[padding:20px_20px_40px] max-[740px]:[padding:18px_max(16px,_env(safe-area-inset-right))_max(32px,_env(safe-area-inset-bottom))_max(16px,_env(safe-area-inset-left))]">
      <div className="page-heading gap-4 flex justify-between items-center min-h-12 mb-4.5 [&_p]:text-muted-foreground [&_p]:text-[13px] [&_p]:mt-1.25 [&_>_div]:min-w-0 [&_>_div]:wrap-anywhere max-[740px]:items-start max-[740px]:mb-4.5 max-[740px]:[&_p]:leading-[1.6] max-[740px]:[&_>_[data-slot='button']]:mt-0.25 max-[740px]:[.setup-page_&]:min-h-0">
        <h1 className="text-[22px] font-semibold tracking-[-0.035em] leading-[1.35] [&>span]:text-muted-foreground [&>span]:text-[13px] [&>span]:font-mono [&>span]:font-normal [&>span]:ml-[8px] [&>span]:align-middle">
          {section === "accounts" ? "Accounts" : "Apps"}
        </h1>
      </div>
      <LoadingRows />
    </div>
  );
}

/** Read the live inventory guaranteed by the enclosing inventory route. */
export function useOverview(): DashboardOverview {
  const overview = useContext(OverviewContext);
  if (overview === undefined) throw new Error("Inventory route must enclose this page");
  return overview;
}
