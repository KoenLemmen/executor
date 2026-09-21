import { useState } from "react";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Exit, Option, Schema } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import type { App } from "@executor-js/sdk";
import type { AppSourceView } from "@executor-js/app-management/contracts";
import { PackageManifest, registryPublicationPath } from "@executor-js/app-registry/contracts";
import { HugeiconsIcon } from "@hugeicons/react";
import { Globe02Icon, LockKeyIcon, Tick02Icon, Upload04Icon } from "@hugeicons/core-free-icons";
import type { AppManagementProps } from "../../contracts/app-management.ts";
import { Button } from "../components/button.tsx";
import { Skeleton } from "../components/skeleton.tsx";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/dialog.tsx";
import { ProviderIcon } from "./common.tsx";
import { QueryView } from "./context.tsx";

function readManifest(source: typeof AppSourceView.Type) {
  const file = source.files.find((file) => file.path === "package.json");
  return file === undefined
    ? undefined
    : Option.getOrUndefined(
        Schema.decodeUnknownOption(Schema.fromJsonString(PackageManifest))(file.content),
      );
}

/** Make publishing available from every app tab; the host still owns permission. */
export function PublishApp<E>({
  app,
  atoms,
  Failure,
}: AppManagementProps<E> & { readonly app: App }) {
  return (
    <QueryView
      query={atoms.source(app.id)}
      Failure={Failure}
      pending={
        <Skeleton className="h-9 w-26 max-[740px]:h-11" aria-label="Loading publishing access" />
      }
    >
      {(source) =>
        source.canPublish && (
          <PublishAction app={app} source={source} atoms={atoms} Failure={Failure} />
        )
      }
    </QueryView>
  );
}

/** Keep the reviewed source fixed while a dialog is open, including during background refreshes. */
function PublishAction<E>({
  app,
  source,
  atoms,
  Failure,
}: AppManagementProps<E> & {
  readonly app: App;
  readonly source: typeof AppSourceView.Type;
}) {
  const [selected, setSelected] = useState<typeof AppSourceView.Type | null>(null);
  const publishing = useAtomValue(atoms.publish(app.id));
  const manifest = readManifest(source);
  return (
    <>
      <QueryView
        query={atoms.published}
        Failure={Failure}
        pending={
          <Skeleton className="h-9 w-44 max-[740px]:h-11" aria-label="Loading publication" />
        }
      >
        {(publications) => (
          <Button onClick={() => setSelected(source)}>
            <HugeiconsIcon icon={Upload04Icon} size={16} strokeWidth={1.8} aria-hidden />
            {publications.some((item) => item.name === manifest?.name)
              ? "Manage Publishing"
              : "Publish"}
          </Button>
        )}
      </QueryView>
      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open && !publishing.waiting) setSelected(null);
        }}
      >
        {selected !== null && (
          <PublishDialog
            app={app}
            source={selected}
            atoms={atoms}
            Failure={Failure}
            onClose={() => setSelected(null)}
          />
        )}
      </Dialog>
    </>
  );
}

/** Show the actual registry listing before sharing this saved source revision. */
function PublishDialog<E>({
  app,
  source,
  atoms,
  Failure,
  onClose,
}: AppManagementProps<E> & {
  readonly app: App;
  readonly source: typeof AppSourceView.Type;
  readonly onClose: () => void;
}) {
  const manifest = readManifest(source);
  return (
    <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-xl">
      <div className="px-7 pb-6 pt-7 max-[740px]:px-5">
        <DialogTitle className="pr-5 text-2xl leading-tight tracking-tight">
          Publish {app.name}
        </DialogTitle>
        <DialogDescription className="mt-2 leading-6">
          Share your app so anyone can find it and make their own copy.
        </DialogDescription>
      </div>
      <div className="px-7 pb-6 max-[740px]:px-5">
        {manifest === undefined ? (
          <div className="rounded-lg border p-5">
            <p className="text-sm font-medium">This app isn’t ready to publish yet</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Ask your agent to give it a public package name. Then you can preview its listing
              here.
            </p>
          </div>
        ) : (
          <>
            <p className="mb-3 text-xs font-medium text-muted-foreground">Your app’s listing</p>
            <div className="flex items-start gap-4 rounded-xl border bg-muted/15 p-5">
              <ProviderIcon name={manifest.name} large />
              <div className="min-w-0 py-0.5">
                <p className="break-words text-base font-semibold tracking-tight">
                  {manifest.name}
                </p>
                {manifest.description && (
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {manifest.description}
                  </p>
                )}
              </div>
            </div>
            <div className="mt-5 space-y-3 text-[13px] leading-5">
              <p className="flex items-start gap-3">
                <HugeiconsIcon
                  icon={Globe02Icon}
                  size={17}
                  className="mt-0.5 shrink-0"
                  aria-hidden
                />
                Your latest saved app files will be public.
              </p>
              <p className="flex items-start gap-3 text-muted-foreground">
                <HugeiconsIcon
                  icon={LockKeyIcon}
                  size={17}
                  className="mt-0.5 shrink-0"
                  aria-hidden
                />
                Connected accounts and app data stay private.
              </p>
            </div>
          </>
        )}
      </div>
      {manifest === undefined ? (
        <div className="flex justify-end border-t bg-muted/10 px-7 py-4 max-[740px]:px-5">
          <Button onClick={onClose}>Done</Button>
        </div>
      ) : (
        <QueryView
          query={atoms.published}
          Failure={Failure}
          pending={
            <div
              className="flex items-center justify-between border-t px-7 py-4 max-[740px]:px-5"
              role="status"
            >
              <span className="text-sm text-muted-foreground">Checking publication…</span>
              <Skeleton className="h-9 w-28 max-[740px]:h-11" />
            </div>
          }
        >
          {(publications) => (
            <PublicationActions
              app={app}
              source={source}
              name={manifest.name}
              publishedCommit={publications.find((item) => item.name === manifest.name)?.commit}
              atoms={atoms}
              Failure={Failure}
              onClose={onClose}
            />
          )}
        </QueryView>
      )}
    </DialogContent>
  );
}

/** Confirm successful writes and keep their result visible while registry reads reconcile. */
function PublicationActions<E>({
  app,
  source,
  name,
  publishedCommit,
  atoms,
  Failure,
  onClose,
}: AppManagementProps<E> & {
  readonly app: App;
  readonly source: typeof AppSourceView.Type;
  readonly name: string;
  readonly publishedCommit: string | undefined;
  readonly onClose: () => void;
}) {
  const publishing = useAtomValue(atoms.publish(app.id));
  const publish = useAtomSet(atoms.publish(app.id), { mode: "promiseExit" });
  const removing = useAtomValue(atoms.unpublish(name));
  const unpublish = useAtomSet(atoms.unpublish(name), { mode: "promiseExit" });
  const [attempted, setAttempted] = useState<"publish" | "unpublish" | null>(null);
  const [completed, setCompleted] = useState<"published" | "unpublished" | null>(null);
  const pending = publishing.waiting || removing.waiting;
  const current = publishedCommit === source.revision.commit;
  return (
    <>
      {attempted === "publish" && AsyncResult.isFailure(publishing) && (
        <Failure cause={publishing.cause} />
      )}
      {attempted === "unpublish" && AsyncResult.isFailure(removing) && (
        <Failure cause={removing.cause} />
      )}
      {(completed !== null || current) && (
        <div
          className="flex items-start gap-3 border-t px-7 py-4 text-sm max-[740px]:px-5"
          role="status"
        >
          <HugeiconsIcon icon={Tick02Icon} size={18} className="mt-0.5 shrink-0" aria-hidden />
          <div>
            <p className="font-medium">
              {completed === "unpublished" ? "App unpublished" : "Your app is published"}
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {completed === "unpublished"
                ? "It no longer appears in discovery. Existing copies keep working."
                : completed === "published"
                  ? "People can find it in Add app and make their own copy."
                  : "Your latest saved changes are already published."}
            </p>
          </div>
        </div>
      )}
      {publishedCommit !== undefined && !current && completed === null && (
        <p className="border-t px-7 py-4 text-sm leading-6 text-muted-foreground max-[740px]:px-5">
          Publish your latest saved changes as the new public version. Existing copies stay as they
          are.
        </p>
      )}
      {publishedCommit !== undefined && completed !== "unpublished" && (
        <div className="px-7 pb-5 max-[740px]:px-5">
          <a
            href={registryPublicationPath(name)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-9 items-center gap-2 text-sm font-medium underline underline-offset-4 hover:text-muted-foreground"
          >
            View published app <span aria-hidden>↗</span>
          </a>
        </div>
      )}
      <div className="flex items-center justify-between gap-3 border-t bg-muted/10 px-7 py-4 max-[740px]:px-5">
        <div>
          {publishedCommit !== undefined && completed === null && (
            <Button
              variant="ghost"
              className="text-muted-foreground hover:text-destructive"
              loading={removing.waiting}
              disabled={pending}
              onClick={async () => {
                setAttempted("unpublish");
                const result = await unpublish();
                if (Exit.isSuccess(result)) setCompleted("unpublished");
              }}
            >
              Unpublish
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {completed !== null || current ? (
            <Button onClick={onClose} disabled={pending} className="min-w-24">
              Done
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose} disabled={pending}>
                Cancel
              </Button>
              <Button
                className="min-w-32"
                loading={publishing.waiting}
                disabled={pending}
                onClick={async () => {
                  setAttempted("publish");
                  const result = await publish(source.revision.commit);
                  if (Exit.isSuccess(result)) setCompleted("published");
                }}
              >
                {publishing.waiting
                  ? "Publishing…"
                  : publishedCommit === undefined
                    ? "Publish app"
                    : "Publish new version"}
              </Button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
