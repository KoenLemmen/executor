import { Option } from "effect";
import { QueryResult, useQuery } from "./context.tsx";
import { FileBracesIcon, FileCodeIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import type { AppSourceProps } from "../../contracts/dashboard.ts";
import { displayDate } from "../../contracts/dashboard.ts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/select.tsx";
import { LoadingRows } from "./common.tsx";
import { Code } from "./code.tsx";
import { cn } from "../lib/utils.ts";

/** Inspect immutable source versions without exposing deployment identifiers. */
export function AppSource<E>({
  app,
  deployments,
  deployment,
  selectedDeployment,
  onDeploymentChange,
  query,
  Failure,
  actions,
}: AppSourceProps<E>) {
  const { result, data: source, refresh } = useQuery(query);
  const [path, setPath] = useState("index.ts");
  const file = Option.isSome(source)
    ? (source.value.files.find((item) => item.path === path) ?? source.value.files[0])
    : undefined;
  const isActive = deployment === app.activeDeployment;

  return (
    <div className="source-section flex flex-col flex-1 min-h-0 [&_>_*]:shrink-0">
      <div className="source-toolbar flex flex-wrap gap-3 items-center mb-3.5 min-h-8.75 [&_[data-slot='select-trigger']]:max-w-[min(480px,_80%)] [&_[data-slot='select-trigger']]:text-[11px] [&_[data-slot='select-trigger']]:shadow-none [&_[data-slot='select-value']_>_span.muted]:hidden max-[740px]:[&_[data-slot='select-trigger']]:max-w-full max-[740px]:[&_[data-slot='select-trigger']]:text-[13px]">
        <Select
          value={selectedDeployment ?? "active"}
          onValueChange={(value) => {
            if (value === "active") {
              onDeploymentChange(undefined);
              return;
            }
            const selected = deployments.find((item) => item.id === value);
            if (selected) onDeploymentChange(selected.id);
          }}
        >
          <SelectTrigger size="sm" aria-label="Inspect deployment">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active deployment</SelectItem>
            {deployments.map((item, index) => (
              <SelectItem value={item.id} key={item.id}>
                <span>Version {deployments.length - index}</span>
                <span className="muted text-muted-foreground">{displayDate(item.createdAt)}</span>
                {item.id === app.activeDeployment && (
                  <span className="active-label text-[10px] bg-accent py-[1px] px-[4px] rounded-[3px] whitespace-nowrap shrink-0">
                    Active
                  </span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="source-caption text-muted-foreground text-[11px] max-[740px]:hidden">
          {isActive ? "Active deployment" : "Viewing retained source"}
        </span>
        {actions}
      </div>
      <QueryResult
        result={result}
        Failure={Failure}
        retry={refresh}
        pending={<LoadingRows count={7} />}
      >
        {(source) => (
          <div className="source-browser border border-border rounded-[8px] overflow-hidden grid grid-cols-[200px_minmax(0,_1fr)] grid-rows-[minmax(0,_1fr)] flex-1 min-h-0 max-[740px]:grid-cols-1 max-[740px]:grid-rows-[auto_minmax(0,_1fr)]">
            <div
              className="file-list overflow-y-auto border-r border-r-border bg-background p-[9px] max-[740px]:border-r-0 max-[740px]:border-b max-[740px]:border-b-border max-[740px]:max-h-40"
              aria-label="Source files"
            >
              {source.files.map((item) => (
                <button
                  key={item.path}
                  className={cn(
                    "file-row hover:bg-muted flex items-center gap-2 w-full p-[8px] rounded-[5px] font-mono text-[11px] text-left [&_>_span]:wrap-anywhere [&_>_span]:min-w-0 [&_>_svg]:text-muted-foreground [&_>_svg]:shrink-0 max-[740px]:min-h-11",
                    file?.path === item.path &&
                      "selected [.tool-row&]:bg-accent [.file-row&]:bg-accent",
                  )}
                  onClick={() => setPath(item.path)}
                >
                  <HugeiconsIcon
                    icon={item.path.endsWith(".json") ? FileBracesIcon : FileCodeIcon}
                    strokeWidth={2}
                    aria-hidden
                    size={14}
                  />
                  <span>{item.path}</span>
                </button>
              ))}
            </div>
            <div className="source-file min-w-0 overflow-auto flex flex-col max-[740px]:min-h-0">
              <div className="source-file-heading flex items-center justify-between gap-3 font-mono text-[11px] min-h-10.5 py-0 px-[16px] border-b border-b-border [&_>_span:first-child]:min-w-0 [&_>_span:first-child]:wrap-anywhere [&_>_span:last-child]:text-[10px] [&_>_span:last-child]:text-muted-foreground [&_>_span:last-child]:whitespace-nowrap max-[740px]:py-[10px] max-[740px]:px-[12px]">
                <span>{file?.path}</span>
                <span>{file?.content.split("\n").length} lines</span>
              </div>
              {file && (
                <Code key={`${deployment}:${file.path}`} code={file.content} path={file.path} />
              )}
            </div>
          </div>
        )}
      </QueryResult>
    </div>
  );
}
