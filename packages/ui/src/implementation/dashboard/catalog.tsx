import { AsyncResult } from "effect/unstable/reactivity";
import { QueryResult } from "./context.tsx";
import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { useState, type ReactNode } from "react";
import { Exit, Option, Schema } from "effect";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, ArrowLeft02Icon, ArrowRight02Icon } from "@hugeicons/core-free-icons";
import { McpImportAuth, type CatalogEntry } from "@executor-js/catalog/contracts";
import type { App } from "@executor-js/sdk";
import type { QueryProps, MutationProps, InstallApp } from "../../contracts/dashboard.ts";
import { Empty, LoadingRows, ProviderIcon, SearchInput } from "./common.tsx";
import { Button } from "../components/button.tsx";
import { Input } from "../components/input.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/select.tsx";

/** Explain unsupported imports before a user opens their install form. */
export const catalogUnavailable = (entry: CatalogEntry) =>
  entry.kind !== "openapi" && entry.kind !== "mcp"
    ? `${entry.kind === "graphql" ? "GraphQL" : "CLI"} import is coming later`
    : !entry.connectUrl
      ? entry.kind === "mcp"
        ? "No MCP server URL available"
        : "No API definition available"
      : undefined;
/** The local catalog layout, shared without a product-specific install permission. */
export function CatalogPage<E>({
  query,
  Failure,
  back,
  action,
  onSelect,
}: QueryProps<readonly CatalogEntry[], E> & {
  readonly back: ReactNode;
  readonly action?: ReactNode;
  readonly onSelect?: ((entry: CatalogEntry) => void) | undefined;
}) {
  const result = useAtomValue(query);
  const retry = useAtomRefresh(query);
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(50);
  const data = AsyncResult.value(result);
  const entries = Option.isSome(data)
    ? data.value
        .filter((entry) =>
          `${entry.name} ${entry.domain} ${entry.kind}`
            .toLowerCase()
            .includes(search.toLowerCase()),
        )
        .sort(
          (a, b) =>
            Number(catalogUnavailable(a) !== undefined) -
              Number(catalogUnavailable(b) !== undefined) ||
            Number(b.feeds?.includes("curated") ?? false) -
              Number(a.feeds?.includes("curated") ?? false) ||
            (b.popularity ?? 0) - (a.popularity ?? 0) ||
            a.name.localeCompare(b.name),
        )
    : [];
  return (
    <div className="page w-full shrink-0 max-w-315 [padding:24px_24px_48px] my-0 mx-auto max-[1000px]:[padding:20px_20px_40px] max-[740px]:[padding:18px_max(16px,_env(safe-area-inset-right))_max(32px,_env(safe-area-inset-bottom))_max(16px,_env(safe-area-inset-left))]">
      {back}
      <div className="page-heading gap-4 flex justify-between items-center min-h-12 mb-4.5 [&_p]:text-muted-foreground [&_p]:text-[13px] [&_p]:mt-1.25 [&_>_div]:min-w-0 [&_>_div]:wrap-anywhere max-[740px]:items-start max-[740px]:mb-4.5 max-[740px]:[&_p]:leading-[1.6] max-[740px]:[&_>_[data-slot='button']]:mt-0.25 max-[740px]:[.setup-page_&]:min-h-0">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.035em] leading-[1.35] [&>span]:text-muted-foreground [&>span]:text-[13px] [&>span]:font-mono [&>span]:font-normal [&>span]:ml-[8px] [&>span]:align-middle">
            Add app
          </h1>
          <p>Browse integrations.sh and make it yours.</p>
        </div>
        {action}
      </div>
      <div className="list-toolbar flex flex-wrap items-center gap-[10px_16px] mb-4">
        <SearchInput
          autoFocus
          value={search}
          onChange={(value) => {
            setSearch(value);
            setLimit(50);
          }}
          placeholder="Search apps…"
        />
        <span className="muted text-muted-foreground">
          {entries.length.toLocaleString()} integrations
        </span>
      </div>
      <QueryResult result={result} Failure={Failure} retry={retry} pending={<LoadingRows />}>
        {() =>
          !entries.length ? (
            <Empty title="No matching apps">Try a different name.</Empty>
          ) : (
            <>
              <div className="catalog-list border-t border-t-border">
                {entries.slice(0, limit).map((entry) => {
                  const reason = catalogUnavailable(entry);
                  return (
                    <button
                      type="button"
                      className="catalog-row w-full flex items-center gap-4 min-h-18.5 text-left py-[15px] px-[12px] border-b border-b-border cursor-pointer [&:hover:not(:disabled)]:bg-muted disabled:cursor-default max-[740px]:grid max-[740px]:grid-cols-[34px_minmax(0,_1fr)_auto] max-[740px]:gap-[4px_12px] max-[740px]:py-[15px] max-[740px]:px-0 max-[740px]:[&_>_svg]:col-[3] max-[740px]:[&_>_svg]:row-[1_/_3]"
                      key={entry.id}
                      disabled={reason !== undefined || onSelect === undefined}
                      onClick={() => onSelect?.(entry)}
                    >
                      <ProviderIcon name={entry.name} url={entry.domain} />
                      <div className="catalog-row-title flex-1 flex flex-col gap-1.25 min-w-0 [&_strong]:text-[13px] [&_strong]:font-medium [&_span]:text-[12px] [&_span]:text-muted-foreground wrap-anywhere max-[740px]:col-[2]">
                        <strong>{entry.name}</strong>
                        <span>{entry.domain}</span>
                      </div>
                      <span className="catalog-kind text-[12px] text-muted-foreground min-w-18.75 max-[740px]:col-[2] max-[740px]:text-[11px]">
                        {entry.kind === "openapi" ? "OpenAPI" : entry.kind.toUpperCase()}
                      </span>
                      {reason ? (
                        <span className="catalog-unavailable text-muted-foreground text-[12px] max-[740px]:col-[2_/_-1]">
                          {reason}
                        </span>
                      ) : (
                        <HugeiconsIcon
                          icon={ArrowRight02Icon}
                          strokeWidth={2}
                          aria-hidden
                          size={15}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
              {entries.length > limit && (
                <Button
                  variant="outline"
                  className="load-more mt-5"
                  onClick={() => setLimit((limit) => limit + 50)}
                >
                  Show more
                </Button>
              )}
            </>
          )
        }
      </QueryResult>
    </div>
  );
}
/** Common install form; the supplied mutation atom owns routing and invalidation. */
export function CatalogInstall<E>({
  mutation,
  Failure,
  entry,
  onBack,
  onInstalled,
}: MutationProps<InstallApp, App, E> & {
  readonly entry: CatalogEntry;
  readonly onBack: () => void;
  readonly onInstalled: (app: App) => void | Promise<void>;
}) {
  const imported = useAtomValue(mutation);
  const add = useAtomSet(mutation, { mode: "promiseExit" });
  const [name, setName] = useState(entry.name);
  const [mcpAuth, setMcpAuth] = useState<McpImportAuth>("auto");
  const [pending, setPending] = useState(false);
  return (
    <div className="page setup-page w-full shrink-0 [padding:24px_24px_48px] my-0 mx-auto max-[1000px]:[padding:20px_20px_40px] max-w-212.5 max-[740px]:[padding:18px_max(16px,_env(safe-area-inset-right))_max(32px,_env(safe-area-inset-bottom))_max(16px,_env(safe-area-inset-left))]">
      <Button
        variant="ghost"
        size="sm"
        className="back-link h-auto rounded-none p-0 font-normal hover:bg-transparent inline-flex gap-1.5 items-center text-[12px] text-muted-foreground mb-4.25 hover:text-foreground max-[740px]:min-h-11 max-[740px]:inline-flex max-[740px]:items-center max-[740px]:-mt-2 max-[740px]:mb-3"
        onClick={onBack}
        disabled={pending}
      >
        <HugeiconsIcon icon={ArrowLeft02Icon} strokeWidth={2} aria-hidden size={14} />
        All apps
      </Button>
      <div className="page-heading gap-4 flex justify-between items-center min-h-12 mb-4.5 [&_p]:text-muted-foreground [&_p]:text-[13px] [&_p]:mt-1.25 [&_>_div]:min-w-0 [&_>_div]:wrap-anywhere max-[740px]:items-start max-[740px]:mb-4.5 max-[740px]:[&_p]:leading-[1.6] max-[740px]:[&_>_[data-slot='button']]:mt-0.25 max-[740px]:[.setup-page_&]:min-h-0">
        <h1 className="text-[22px] font-semibold tracking-[-0.035em] leading-[1.35] [&>span]:text-muted-foreground [&>span]:text-[13px] [&>span]:font-mono [&>span]:font-normal [&>span]:ml-[8px] [&>span]:align-middle">
          Add app
        </h1>
      </div>
      <form
        className="setup-form max-w-145 flex flex-col gap-5.75 pt-2.5 max-[740px]:gap-5.25"
        onSubmit={(event) => {
          event.preventDefault();
          if (pending || !name.trim()) return;
          setPending(true);
          void add({
            entry: entry.id,
            name: name.trim(),
            ...(entry.kind === "mcp" ? { mcpAuth } : {}),
          }).then((exit) => {
            setPending(false);
            if (Exit.isSuccess(exit)) {
              void onInstalled(exit.value);
            }
          });
        }}
      >
        <div className="setup-provider flex items-center gap-3.25 [&_h2]:text-[16px] [&_h2]:[font-weight:550] [&_>_div]:min-w-0 [&_>_div]:wrap-anywhere">
          <ProviderIcon name={entry.name} url={entry.domain} large />
          <div>
            <h2>{entry.name}</h2>
            <span className="row-meta flex flex-wrap gap-1.5 items-center mt-0.75 text-[11px] text-muted-foreground">
              {entry.kind === "mcp" ? "MCP" : "OpenAPI"} · {entry.domain}
            </span>
          </div>
        </div>
        <p className="catalog-description text-muted-foreground text-[13px] leading-[1.6]">
          {entry.description}
        </p>
        <label className="field-label flex flex-col gap-2.25 text-[13px] font-medium [&_[data-slot='select-trigger']]:w-full">
          App name
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            disabled={pending}
            maxLength={120}
          />
        </label>
        {entry.kind === "mcp" && (
          <label className="field-label flex flex-col gap-2.25 text-[13px] font-medium [&_[data-slot='select-trigger']]:w-full">
            Sign-in method
            <Select
              value={mcpAuth}
              disabled={pending}
              onValueChange={(value) => {
                const parsed = Schema.decodeUnknownOption(McpImportAuth)(value);
                if (Option.isSome(parsed)) setMcpAuth(parsed.value);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Automatic</SelectItem>
                <SelectItem value="oauth">OAuth</SelectItem>
                <SelectItem value="apiKey">API key</SelectItem>
                <SelectItem value="none">No authentication</SelectItem>
              </SelectContent>
            </Select>
          </label>
        )}
        <span className="field-hint text-muted-foreground text-[12px] font-normal leading-[1.5] [.mcp-install-content_>_&]:mt-5">
          {entry.kind === "mcp"
            ? "Tools load live with your selected account."
            : "Creates editable app source from this API definition."}
        </span>
        {AsyncResult.isFailure(imported) && <Failure cause={imported.cause} />}
        <div className="form-actions flex items-center gap-5 pt-1 text-[13px] [&_a]:text-muted-foreground max-[740px]:[&_>_a]:min-h-11 max-[740px]:[&_>_a]:inline-flex max-[740px]:[&_>_a]:items-center max-[740px]:flex-wrap max-[740px]:gap-[12px_20px]">
          <Button disabled={pending || !name.trim()} type="submit">
            <HugeiconsIcon icon={Add01Icon} strokeWidth={2} aria-hidden size={14} />
            {pending ? "Building app…" : "Add app"}
          </Button>
        </div>
      </form>
    </div>
  );
}
