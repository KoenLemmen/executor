import { useEffect, useState, type ReactNode } from "react";
import { RegistryProvider, useAtomValue } from "@effect/atom-react";
import { Cause, Option } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import {
  registryPublicationPath,
  type Publication,
  type PublicationSnapshot,
  type RegistryError,
} from "@executor-js/app-registry/contracts";
import {
  publicApps,
  publicApp,
  publicAppFiles,
  publicAppsLocation,
} from "../contracts/public-apps.ts";

function usePageTitle(title: string) {
  useEffect(() => {
    document.title = `${title} — Executor`;
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (canonical !== null) {
      const url = new URL(canonical.href);
      url.pathname = window.location.pathname;
      canonical.href = url.href;
    }
  }, [title]);
}

function RegistryQuery<A>({
  result,
  children,
  label,
}: {
  readonly result: AsyncResult.AsyncResult<A, RegistryError>;
  readonly children: (value: A) => ReactNode;
  readonly label: string;
}) {
  const data = AsyncResult.value(result);
  return (
    <>
      {AsyncResult.isFailure(result) && <ReadFailure cause={result.cause} />}
      {Option.isSome(data)
        ? children(data.value)
        : !AsyncResult.isFailure(result) && (
            <p role="status" className="min-h-40 border-y border-rule py-8 text-sm text-ink-2">
              {label}
            </p>
          )}
    </>
  );
}
function ReadFailure({ cause }: { readonly cause: Cause.Cause<RegistryError> }) {
  const error = Option.getOrUndefined(Cause.findErrorOption(cause));
  return (
    <div role="alert" className="mb-6 border border-rule p-5 text-sm leading-6">
      <p>
        {error?.reason === "changed"
          ? "A new version has been published. Reload to see it."
          : error?.reason === "not-found"
            ? "This app is no longer published. Existing copies are unchanged."
            : "The published app could not be loaded. Try again."}
      </p>
      <button
        type="button"
        className="mt-3 underline underline-offset-4"
        onClick={() => window.location.reload()}
      >
        Reload
      </button>
    </div>
  );
}

/** Live public data is an island inside the same static site frame used by marketing and Docs. */
export default function AppsDirectory() {
  const location = publicAppsLocation(window.location.pathname);
  return (
    <RegistryProvider>
      {location.kind === "directory" ? (
        <Directory />
      ) : location.kind === "app" ? (
        <AppPage name={location.name} />
      ) : (
        <>
          <h1 className="text-2xl font-semibold">App not found</h1>
          <a href="/apps" className="mt-4 inline-block underline underline-offset-4">
            Browse apps
          </a>
        </>
      )}
    </RegistryProvider>
  );
}
function Directory() {
  usePageTitle("Apps");
  const result = useAtomValue(publicApps);
  const [search, setSearch] = useState("");
  return (
    <>
      <h1 className="text-[clamp(1.75rem,3vw,2.25rem)] font-semibold tracking-tight">Apps</h1>
      <p className="mt-4 max-w-2xl text-base leading-7 text-ink-2">
        Find a published app, view its source, and make a copy in Executor.
      </p>
      <div className="mb-4 mt-8 grid grid-cols-3 gap-4 max-[1100px]:grid-cols-2 max-[600px]:grid-cols-1">
        <label className="min-w-0">
          <span className="sr-only">Search apps</span>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search apps…"
            className="w-full rounded-md border border-rule-strong bg-surface px-3 py-2.5 text-sm text-ink outline-offset-2 focus-visible:outline-ink"
          />
        </label>
      </div>
      <RegistryQuery result={result} label="Loading apps…">
        {(publications) => {
          const matching = publications.filter((item) =>
            `${item.name} ${item.description}`.toLowerCase().includes(search.toLowerCase()),
          );
          return matching.length === 0 ? (
            <p className="border-y border-rule py-10 text-sm text-ink-2">
              {publications.length === 0
                ? "No apps have been published yet."
                : "No matching apps. Try another search."}
            </p>
          ) : (
            <div className="grid grid-cols-3 [grid-auto-rows:1fr] gap-4 max-[1100px]:grid-cols-2 max-[600px]:grid-cols-1">
              {matching.map((publication) => (
                <a
                  key={publication.name}
                  href={registryPublicationPath(publication.name)}
                  className="min-w-0 rounded-lg border border-rule p-5 transition-colors hover:border-rule-strong hover:bg-surface-2 focus-visible:outline-ink"
                >
                  <h2 className="break-words text-sm font-semibold">{publication.name}</h2>
                  {publication.description && (
                    <p className="mt-3 line-clamp-3 text-sm leading-6 text-ink-2">
                      {publication.description}
                    </p>
                  )}
                  <span className="mt-5 inline-block text-xs text-ink-2">
                    View app <span aria-hidden>↗</span>
                  </span>
                </a>
              ))}
            </div>
          );
        }}
      </RegistryQuery>
    </>
  );
}
function AppPage({ name }: { readonly name: string }) {
  usePageTitle(name);
  const result = useAtomValue(publicApp(name));
  return (
    <>
      <a
        href="/apps"
        className="mb-7 inline-flex min-h-9 items-center text-sm text-ink-2 hover:text-ink"
      >
        ← All apps
      </a>
      <RegistryQuery result={result} label="Loading app…">
        {(publications) => {
          const publication = publications.find((item) => item.name === name);
          return publication === undefined ? (
            <>
              <h1 className="text-2xl font-semibold">This app is not published</h1>
              <p className="mt-3 text-sm leading-6 text-ink-2">
                The listing may have been removed. Existing copies are unchanged.
              </p>
            </>
          ) : (
            <AppPublication publication={publication} />
          );
        }}
      </RegistryQuery>
    </>
  );
}
function AppPublication({ publication }: { readonly publication: typeof Publication.Type }) {
  const source = useAtomValue(publicAppFiles(publication.name, publication.commit));
  const [copyLabel, setCopyLabel] = useState("Copy link");
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div className="min-w-0 flex-1">
          <h1 className="break-words text-[clamp(1.4rem,2.5vw,2rem)] font-semibold tracking-tight">
            {publication.name}
          </h1>
          {publication.description && (
            <p className="mt-4 max-w-2xl text-base leading-7 text-ink-2">
              {publication.description}
            </p>
          )}
        </div>
        <button
          type="button"
          className="rounded-md border border-rule-strong px-3 py-2 text-sm hover:bg-surface-2"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                new URL(registryPublicationPath(publication.name), window.location.origin).href,
              );
              setCopyLabel("Copied");
            } catch {
              setCopyLabel("Could not copy");
            }
          }}
        >
          {copyLabel}
        </button>
      </div>
      <p className="mt-5 text-xs leading-6 text-ink-3">
        Published {new Date(publication.publishedAt).toLocaleDateString()} · Find this package in
        Add app to make a copy.
      </p>
      <section className="mt-9" aria-label="Published source">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 className="text-sm font-medium">Published source</h2>
          <code title={publication.commit} className="text-xs text-ink-3">
            {publication.commit.slice(0, 7)}
          </code>
        </div>
        <RegistryQuery result={source} label="Loading published files…">
          {(snapshot) => (
            <PublishedFiles key={snapshot.publication.commit} files={snapshot.files} />
          )}
        </RegistryQuery>
      </section>
    </>
  );
}
function PublishedFiles({ files }: { readonly files: typeof PublicationSnapshot.Type.files }) {
  const [selected, setSelected] = useState("index.ts");
  const file = files.find((item) => item.path === selected) ?? files[0];
  return (
    <div className="grid min-h-96 grid-cols-[11rem_minmax(0,1fr)] overflow-hidden rounded-lg border border-rule max-[719.98px]:grid-cols-1">
      <nav
        aria-label="Source files"
        className="max-h-[34rem] overflow-auto border-r border-rule bg-surface-2 p-2 max-[719.98px]:hidden"
      >
        {files.map((item) => (
          <button
            key={item.path}
            type="button"
            title={item.path}
            aria-pressed={item.path === file?.path}
            onClick={() => setSelected(item.path)}
            className={`block w-full truncate rounded px-2 py-2 text-left font-mono text-xs hover:bg-rule ${item.path === file?.path ? "bg-rule font-medium text-ink" : "text-ink-2"}`}
          >
            {item.path}
          </button>
        ))}
      </nav>
      <div className="min-w-0">
        <div className="border-b border-rule px-4 py-3 text-xs">
          <span className="font-mono max-[719.98px]:hidden">{file?.path}</span>
          <select
            aria-label="Source file"
            value={file?.path}
            onChange={(event) => setSelected(event.target.value)}
            className="w-full bg-surface font-mono min-[720px]:hidden"
          >
            {files.map((item) => (
              <option key={item.path} value={item.path}>
                {item.path}
              </option>
            ))}
          </select>
        </div>
        <pre className="m-0 max-h-[34rem] min-h-80 overflow-auto p-5 font-mono text-xs leading-6 text-ink">
          <code>{file?.content}</code>
        </pre>
      </div>
    </div>
  );
}
