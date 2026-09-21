import { useAtomSet } from "@effect/atom-react";
import { Exit, Option, Redacted, Schema } from "effect";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  CommandLineIcon,
  Copy01Icon,
  Plug01Icon,
  Tick02Icon,
  ViewIcon,
  ViewOffSlashIcon,
} from "@hugeicons/core-free-icons";
import { useState, type ReactNode } from "react";
import { copyMcpInstallAtom, McpInstallFormat } from "../../contracts/mcp.ts";
import { mcpInstallCode } from "../lib/mcp-install.ts";
import { Code } from "./code.tsx";
import { Button } from "../components/button.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/tabs.tsx";

/** Shared Connect page shell; each product owns its data loading and authentication. */
export function ConnectPage({ children }: { readonly children: ReactNode }) {
  return (
    <div className="page mcp-install-page w-full shrink-0 max-w-315 [padding:24px_24px_48px] my-0 mx-auto max-[1000px]:[padding:20px_20px_40px] max-[740px]:[padding:18px_max(16px,_env(safe-area-inset-right))_max(32px,_env(safe-area-inset-bottom))_max(16px,_env(safe-area-inset-left))]">
      <div className="page-heading gap-4 flex justify-between items-center min-h-12 mb-4.5 [&_p]:text-muted-foreground [&_p]:text-[13px] [&_p]:mt-1.25 [&_>_div]:min-w-0 [&_>_div]:wrap-anywhere max-[740px]:items-start max-[740px]:mb-4.5 max-[740px]:[&_p]:leading-[1.6] max-[740px]:[&_>_[data-slot='button']]:mt-0.25 max-[740px]:[.setup-page_&]:min-h-0">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.035em] leading-[1.35] [&>span]:text-muted-foreground [&>span]:text-[13px] [&>span]:font-mono [&>span]:font-normal [&>span]:ml-[8px] [&>span]:align-middle">
            Connect an agent
          </h1>
          <p>Use your Executor apps from Claude Code, Cursor, OpenCode, and other MCP clients.</p>
        </div>
      </div>
      {children}
    </div>
  );
}

/** Client setup with an optional bearer credential and product-specific help text. */
export function McpInstallInstructions({
  endpoint,
  apiKey,
  children,
}: {
  readonly endpoint: string;
  readonly apiKey?: Redacted.Redacted<string>;
  readonly children: ReactNode;
}) {
  const [format, setFormat] = useState<McpInstallFormat>("installer");
  const [showKey, setShowKey] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const copy = useAtomSet(copyMcpInstallAtom, { mode: "promiseExit" });
  const code = mcpInstallCode(
    format,
    endpoint,
    apiKey === undefined ? undefined : showKey ? Redacted.value(apiKey) : "••••••••",
  );
  return (
    <div className="mcp-install-content max-w-200 max-[740px]:[&_[data-slot='tabs-list']]:w-full max-[740px]:[&_[data-slot='tabs-trigger']]:min-h-10 max-[740px]:[&_[data-slot='tabs-trigger']]:text-[12px] max-[740px]:[&_[data-slot='tabs-list']]:h-auto">
      <div className="mcp-endpoint flex items-center gap-2.5 pb-6 text-[12px] [&_>_svg]:text-muted-foreground [&_>_svg]:shrink-0 [&_code]:min-w-0 [&_code]:wrap-anywhere [&_>_span]:text-muted-foreground [&_>_span]:ml-auto [&_>_span]:whitespace-nowrap max-[740px]:flex-wrap max-[740px]:[&_>_span]:ml-6.5 max-[740px]:[&_>_span]:basis-[100%]">
        <HugeiconsIcon icon={Plug01Icon} strokeWidth={2} aria-hidden size={16} />
        <code>{endpoint}</code>
        <span>Streamable HTTP</span>
      </div>
      <Tabs
        value={format}
        onValueChange={(value) => {
          const parsed = Schema.decodeUnknownOption(McpInstallFormat)(value);
          if (Option.isSome(parsed)) {
            setFormat(parsed.value);
            setCopied(false);
            setCopyFailed(false);
          }
        }}
      >
        <TabsList aria-label="Installation method">
          <TabsTrigger value="installer">Quick install</TabsTrigger>
          <TabsTrigger value="claude">Claude Code</TabsTrigger>
          <TabsTrigger value="json">Manual config</TabsTrigger>
        </TabsList>
        {(["installer", "claude", "json"] as const).map((method) => (
          <TabsContent key={method} value={method}>
            <p className="mcp-install-step text-[13px] text-muted-foreground [margin:18px_0_14px]">
              {method === "installer"
                ? "Run in your terminal, then choose your agent."
                : method === "claude"
                  ? "Run in your terminal to add Executor to Claude Code for all projects."
                  : "Merge this entry into your client’s MCP configuration."}
            </p>
            <div className="mcp-install-code overflow-hidden border border-border rounded-[8px]">
              <div className="mcp-code-toolbar flex items-center justify-between gap-3 py-[8px] px-[12px] text-[12px] text-muted-foreground border-b border-b-border [&_>_span]:flex [&_>_span]:items-center [&_>_span]:gap-2">
                <span>
                  <HugeiconsIcon icon={CommandLineIcon} strokeWidth={2} aria-hidden size={14} />
                  {method === "json" ? "MCP configuration" : "Terminal"}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setCopyFailed(false);
                    void copy(
                      Redacted.make(
                        mcpInstallCode(
                          format,
                          endpoint,
                          apiKey === undefined ? undefined : Redacted.value(apiKey),
                        ),
                      ),
                    ).then((exit) => {
                      setCopied(Exit.isSuccess(exit));
                      setCopyFailed(Exit.isFailure(exit));
                    });
                  }}
                >
                  {copied ? (
                    <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} aria-hidden size={14} />
                  ) : (
                    <HugeiconsIcon icon={Copy01Icon} strokeWidth={2} aria-hidden size={14} />
                  )}
                  {copied ? "Copied" : method === "json" ? "Copy config" : "Copy command"}
                </Button>
              </div>
              <Code code={code} path={method === "json" ? "mcp.json" : "install.sh"} />
              {apiKey !== undefined && (
                <div className="mcp-code-footer flex items-center justify-between gap-3 py-[8px] px-[12px] text-[12px] text-muted-foreground border-t border-t-border">
                  <span>Copy includes your API key.</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowKey(!showKey)}
                    aria-pressed={showKey}
                  >
                    {showKey ? (
                      <HugeiconsIcon
                        icon={ViewOffSlashIcon}
                        strokeWidth={2}
                        aria-hidden
                        size={14}
                      />
                    ) : (
                      <HugeiconsIcon icon={ViewIcon} strokeWidth={2} aria-hidden size={14} />
                    )}
                    {showKey ? "Hide key" : "Show key"}
                  </Button>
                </div>
              )}
            </div>
          </TabsContent>
        ))}
      </Tabs>
      {copyFailed && (
        <p className="mcp-copy-error mt-3.5 text-destructive text-[13px]" role="alert">
          {apiKey === undefined
            ? "Could not copy. Select and copy the text instead."
            : "Could not copy. Show the key, then select and copy the text."}
        </p>
      )}
      <p className="field-hint text-muted-foreground text-[12px] font-normal leading-[1.5] [.mcp-install-content_>_&]:mt-5">
        {children}
      </p>
    </div>
  );
}
