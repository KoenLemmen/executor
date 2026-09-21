import type { App } from "@executor-js/sdk";
import type { ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger } from "../components/tabs.tsx";
import { ProviderIcon } from "./common.tsx";
import { providerDisplayUrl } from "../../contracts/dashboard.ts";
import { cn } from "../lib/utils.ts";
import { productTitle, useDocumentTitle } from "../hooks/document-title.ts";

/** Shared detail frame. Tabs and actions are composed by each product. */
export function AppDetailLayout<Tab extends string>({
  app,
  tab,
  tabs,
  onTabChange,
  back,
  actions,
  children,
}: {
  readonly app: App | undefined;
  readonly tab: Tab;
  readonly tabs: readonly { readonly id: Tab; readonly label: string }[];
  readonly onTabChange: (tab: Tab) => void;
  readonly back: ReactNode;
  readonly actions?: ReactNode;
  readonly children: ReactNode;
}) {
  const provider = app && Object.values(app.requirements.accounts)[0]?.definition;
  useDocumentTitle(productTitle(app?.name ?? "App"));
  return (
    <div
      className={cn(
        "page detail-page w-full shrink-0 max-w-315 [padding:24px_24px_48px] my-0 mx-auto max-[1000px]:[padding:20px_20px_40px] max-[740px]:[padding:18px_max(16px,_env(safe-area-inset-right))_max(32px,_env(safe-area-inset-bottom))_max(16px,_env(safe-area-inset-left))]",
        tab !== "accounts" &&
          "app-browser-page [.page&]:flex [.page&]:flex-col [.page&]:flex-1 [.page&]:min-h-0 [.page&]:pb-[max(16px,_env(safe-area-inset-bottom))] [&_>_:not(.tools-section):not(.source-section)]:shrink-0",
      )}
    >
      {back}
      <div className="detail-heading wrap-anywhere flex items-center gap-3.25 min-h-12.25 [&_>_div]:min-w-0 [&_>_div]:wrap-anywhere max-[740px]:gap-2.75 max-[740px]:[&_h1]:text-[21px]">
        <ProviderIcon
          name={provider?.name ?? app?.name ?? "App"}
          url={providerDisplayUrl(provider)}
          large
        />
        <div className="grow">
          <h1 className="text-[22px] font-semibold tracking-[-0.035em] leading-[1.35] [&>span]:text-muted-foreground [&>span]:text-[13px] [&>span]:font-mono [&>span]:font-normal [&>span]:ml-[8px] [&>span]:align-middle">
            {app?.name ?? "App"}
          </h1>
        </div>
        {actions}
      </div>
      <Tabs
        value={tab}
        onValueChange={(value) => {
          const selected = tabs.find((tab) => tab.id === value);
          if (selected) onTabChange(selected.id);
        }}
        className="detail-tabs mt-6 border-b border-b-border mb-5.25 [&_[data-slot='tabs-list']]:[padding:0_0_5px] [&_[data-slot='tabs-list']]:gap-4.25 [&_[data-slot='tabs-list']]:h-8.5 [&_[data-slot='tabs-trigger']]:text-[13px] [&_[data-slot='tabs-trigger']]:pl-0.25 [&_[data-slot='tabs-trigger']]:pr-0.25 max-[740px]:mt-5 max-[740px]:mb-4.5 max-[740px]:[&_[data-slot='tabs-list']]:h-auto max-[740px]:[&_[data-slot='tabs-list']]:gap-5 max-[740px]:[&_[data-slot='tabs-trigger']]:min-h-11"
      >
        <TabsList variant="line">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {children}
    </div>
  );
}
