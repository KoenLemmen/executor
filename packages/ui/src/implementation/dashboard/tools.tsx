import { useState, type ReactNode } from "react";
import type { Tool } from "@executor-js/sdk";
import { Option } from "effect";
import { HugeiconsIcon } from "@hugeicons/react";
import { SourceCodeIcon } from "@hugeicons/core-free-icons";
import type { QueryProps } from "../../contracts/dashboard.ts";
import { QueryResult, useQuery } from "./context.tsx";
import { Code, CopyButton } from "./code.tsx";
import { ToolMarkdown } from "./markdown.tsx";
import { Button } from "../components/button.tsx";
import { Empty, SearchInput } from "./common.tsx";
import { Skeleton } from "../components/skeleton.tsx";
import { cn } from "../lib/utils.ts";

/** Stable list/inspector layout. Hosts choose navigation and any tool execution controls. */
export function ToolBrowser<E>({
  query,
  Failure,
  selected,
  onSelect,
  back,
  renderAction,
}: QueryProps<readonly Tool[], E> & {
  readonly selected: string | undefined;
  readonly onSelect: (tool: string) => void;
  readonly back: ReactNode;
  readonly renderAction?: (tool: Tool) => ReactNode;
}) {
  const { result, data, refresh } = useQuery(query);
  const [search, setSearch] = useState("");
  const tools = Option.isSome(data) ? data.value : [];
  const filtered = tools.filter((tool) =>
    `${tool.name} ${tool.description}`.toLowerCase().includes(search.toLowerCase()),
  );
  const current = tools.find((tool) => tool.name === selected) ?? filtered[0];
  const inspecting = selected !== undefined && current?.name === selected;
  return (
    <div
      className={cn(
        "tools-section flex flex-col flex-1 min-h-0 [&_>_*]:shrink-0",
        inspecting && "is-inspecting",
      )}
    >
      <div className="tool-back hidden max-[740px]:[.tools-section:not(.is-inspecting)_&]:hidden max-[740px]:[.is-inspecting_&]:inline-flex">
        {back}
      </div>
      <div className="tool-toolbar flex gap-3 items-center mb-3.5 min-h-8.75 [&_>_button]:ml-auto max-[740px]:grid max-[740px]:grid-cols-[minmax(0,_1fr)_44px] max-[740px]:gap-[0_8px] max-[740px]:[.is-inspecting_&]:hidden">
        <SearchInput value={search} onChange={setSearch} placeholder="Search tools…" />
        <span className="tool-count text-muted-foreground text-[11px] max-[740px]:whitespace-nowrap">
          {Option.isSome(data)
            ? `${filtered.length}${search ? ` of ${tools.length}` : ""} tools`
            : "Live tools"}
        </span>
      </div>
      <QueryResult
        result={result}
        Failure={Failure}
        retry={refresh}
        pending={<ToolContentLoading />}
      >
        {() =>
          tools.length === 0 ? (
            <Empty title="No tools">This app's live definition did not expose any tools.</Empty>
          ) : filtered.length === 0 ? (
            <Empty title="No matching tools">Search by name or description.</Empty>
          ) : (
            <div className="tool-browser border border-border rounded-[8px] overflow-hidden grid grid-cols-[minmax(230px,_0.83fr)_minmax(0,_1.17fr)] grid-rows-[minmax(0,_1fr)] flex-1 min-h-0 max-[1000px]:grid-cols-[minmax(200px,_0.9fr)_minmax(0,_1.1fr)] max-[740px]:grid-cols-1 max-[740px]:h-auto max-[740px]:min-h-0">
              <div
                className="tool-list overflow-y-auto border-r border-r-border bg-background max-[740px]:border-0 max-[740px]:[.is-inspecting_&]:hidden"
                aria-label="App tools"
              >
                {filtered.map((tool) => (
                  <button
                    className={cn(
                      "tool-row block text-left [padding:17px_17px_15px] w-full border-b border-b-border [transition:background_0.1s] hover:bg-muted max-[740px]:py-[17px] max-[740px]:px-[16px]",
                      current?.name === tool.name &&
                        "selected [.tool-row&]:bg-accent [.file-row&]:bg-accent",
                    )}
                    aria-pressed={current?.name === tool.name}
                    key={tool.name}
                    onClick={() => onSelect(tool.name)}
                  >
                    <span className="tool-row-title flex items-center gap-2 [&_svg]:text-muted-foreground [&_svg]:shrink-0 [&_code]:text-[11px] [&_code]:font-medium [&_code]:wrap-anywhere max-[740px]:[&_code]:text-[12px]">
                      <HugeiconsIcon icon={SourceCodeIcon} strokeWidth={2} aria-hidden size={14} />
                      <code>{tool.name}</code>
                    </span>
                    <span className="tool-row-description [display:-webkit-box] [-webkit-line-clamp:2] [-webkit-box-orient:vertical] overflow-hidden text-muted-foreground text-[12px] leading-[1.5] mt-1.25 max-[740px]:text-[13px]">
                      {tool.description || "No description"}
                    </span>
                  </button>
                ))}
              </div>
              <div className="tool-detail min-w-0 overflow-auto py-[23px] px-[24px] max-[1000px]:py-[20px] max-[1000px]:px-[18px] max-[740px]:hidden max-[740px]:py-[18px] max-[740px]:px-[16px] max-[740px]:[.is-inspecting_&]:block">
                {current && (
                  <>
                    <div className="tool-detail-heading flex items-start gap-2.25 [&_svg]:text-muted-foreground [&_svg]:shrink-0 [&_svg]:mt-0.5 [&_h2]:font-mono [&_h2]:text-[13px] [&_h2]:font-medium [&_h2]:wrap-anywhere [&_[data-slot='button']]:ml-auto">
                      <HugeiconsIcon icon={SourceCodeIcon} strokeWidth={2} aria-hidden size={17} />
                      <h2>{current.name}</h2>
                      <CopyButton code={current.name} label="Copy tool name" inline />
                    </div>
                    <ToolDescription key={current.name} description={current.description} />
                    <div className="schema-label text-[11px] font-medium text-muted-foreground [margin:26px_0_10px]">
                      Input schema
                    </div>
                    <Code
                      code={JSON.stringify(current.inputSchema, null, 2)}
                      copyable
                      copyLabel="Copy input schema"
                    />
                    {current.outputSchema !== undefined && (
                      <>
                        <div className="schema-label text-[11px] font-medium text-muted-foreground [margin:26px_0_10px]">
                          Output schema
                        </div>
                        <Code
                          code={JSON.stringify(current.outputSchema, null, 2)}
                          copyable
                          copyLabel="Copy output schema"
                        />
                      </>
                    )}
                    {renderAction?.(current)}
                  </>
                )}
              </div>
            </div>
          )
        }
      </QueryResult>
    </div>
  );
}

function ToolDescription({ description }: { readonly description: string }) {
  const [expanded, setExpanded] = useState(false);
  const text = description || "This tool does not include a description.";
  const long = text.length > 360 || text.split(/\r?\n/).length > 6;
  return (
    <div className="tool-description text-muted-foreground text-[13px] leading-[1.65] mt-3.5 wrap-anywhere [&_p]:[margin:0_0_9px] [&_p:last-child]:mb-0 [&_ul]:[margin:6px_0_9px_18px] [&_ol]:[margin:6px_0_9px_18px] [&_code]:font-mono [&_code]:text-[11px] [&_a]:underline [&_a]:underline-offset-[2px] [&_h1]:text-foreground [&_h1]:text-[13px] [&_h1]:font-semibold [&_h1]:[margin:10px_0_5px] [&_h2]:text-foreground [&_h2]:text-[13px] [&_h2]:font-semibold [&_h2]:[margin:10px_0_5px] [&_h3]:text-foreground [&_h3]:text-[13px] [&_h3]:font-semibold [&_h3]:[margin:10px_0_5px]">
      <div
        className={cn(
          long &&
            !expanded &&
            "is-collapsed [.tool-description_>_&]:max-h-28 [.tool-description_>_&]:overflow-hidden [.tool-description_>_&]:relative [.tool-description_>_&::after]:[content:''] [.tool-description_>_&::after]:absolute [.tool-description_>_&::after]:right-0 [.tool-description_>_&::after]:bottom-0 [.tool-description_>_&::after]:left-0 [.tool-description_>_&::after]:h-8 [.tool-description_>_&::after]:[background:linear-gradient(transparent,_var(--background))] [.tool-description_>_&::after]:pointer-events-none",
        )}
      >
        <ToolMarkdown>{text}</ToolMarkdown>
      </div>
      {long && (
        <Button
          type="button"
          variant="link"
          size="xs"
          className="tool-description-toggle mt-1.5 p-0 h-auto relative z-1"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Show less" : "Show more"}
        </Button>
      )}
    </div>
  );
}

/** Reserve the tool panel without predicting the result count or account requirements. */
function ToolContentLoading({ label = "Loading tools" }: { readonly label?: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="flex flex-1 min-h-48 items-center justify-center rounded-lg border bg-muted/20"
    >
      <span className="text-xs text-muted-foreground">{label}…</span>
    </div>
  );
}

/** Keep the tools toolbar and panel footprint while app metadata is still unknown. */
export function ToolBrowserLoading({ label = "Loading app" }: { readonly label?: string }) {
  return (
    <div className="tools-section flex flex-col flex-1 min-h-0">
      <div
        aria-hidden
        className="flex items-center gap-3 mb-3.5 min-h-8.75 max-[740px]:grid max-[740px]:grid-cols-[minmax(0,_1fr)_44px] max-[740px]:gap-[0_8px]"
      >
        <Skeleton className="h-8.75 w-full max-w-85 rounded-md max-[740px]:h-11 max-[740px]:max-w-none max-[740px]:col-[1_/_-1]" />
        <span className="text-muted-foreground text-[11px] max-[740px]:whitespace-nowrap">
          Live tools
        </span>
      </div>
      <ToolContentLoading label={label} />
    </div>
  );
}
