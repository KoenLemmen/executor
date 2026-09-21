import { RegistryContext, useAtomSet, useAtomValue } from "@effect/atom-react";
import type { App, DeploymentId } from "@executor-js/sdk";
import { AppSource as SharedAppSource } from "@executor-js/ui/dashboard/app-source";
import { QueryView } from "@executor-js/ui/dashboard/context";
import { Button } from "@executor-js/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@executor-js/ui/components/dialog";
import { Exit, type Cause } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { useContext, useState } from "react";
import { activateAppAtom, appAtom, deploymentsAtom, sourceAtom } from "../../contracts/apps.ts";
import type { HostedError } from "../../contracts/errors.ts";
import { HostedFailure } from "../components/dashboard-bindings.tsx";
import { useOrganizationRoute } from "../components/organization.tsx";

/** Hosts own reads and activation authority; source browsing shares the local presentation. */
export function AppSource({ app }: { readonly app: App }) {
  const { organization } = useOrganizationRoute();
  const [selected, setSelected] = useState<DeploymentId>();
  const deployment = selected ?? app.activeDeployment;
  return (
    <QueryView query={deploymentsAtom({ organization, app: app.id })} Failure={HostedFailure}>
      {(deployments) => (
        <SharedAppSource
          app={app}
          deployments={deployments}
          deployment={deployment}
          selectedDeployment={selected}
          onDeploymentChange={setSelected}
          query={sourceAtom({ organization, app: app.id, deployment })}
          Failure={HostedFailure}
          actions={
            deployment !== app.activeDeployment && (
              <ActivateDeployment key={deployment} app={app} deployment={deployment} />
            )
          }
        />
      )}
    </QueryView>
  );
}

function ActivateDeployment({
  app,
  deployment,
}: {
  readonly app: App;
  readonly deployment: DeploymentId;
}) {
  const { organization } = useOrganizationRoute();
  const registry = useContext(RegistryContext);
  const source = useAtomValue(sourceAtom({ organization, app: app.id, deployment }));
  const activate = useAtomSet(activateAppAtom({ organization, app: app.id }), {
    mode: "promiseExit",
  });
  const [expected, setExpected] = useState<DeploymentId>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Cause.Cause<HostedError>>();
  const refresh = () => {
    registry.refresh(appAtom({ organization, app: app.id }));
    registry.refresh(deploymentsAtom({ organization, app: app.id }));
  };
  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={!AsyncResult.isSuccess(source)}
        onClick={() => {
          setExpected(app.activeDeployment);
          setError(undefined);
        }}
      >
        Activate version
      </Button>
      <Dialog
        open={expected !== undefined}
        onOpenChange={(open) => {
          if (!open && !pending) {
            setExpected(undefined);
            setError(undefined);
          }
        }}
      >
        <DialogContent>
          <DialogTitle>Activate this version?</DialogTitle>
          <DialogDescription>
            New calls will use this code. App data and changes made in other services will not be
            rolled back.
          </DialogDescription>
          {error && (
            <HostedFailure
              cause={error}
              retry={() => {
                refresh();
                setExpected(undefined);
                setError(undefined);
              }}
            />
          )}
          <DialogFooter>
            <Button variant="outline" disabled={pending} onClick={() => setExpected(undefined)}>
              Cancel
            </Button>
            <Button
              loading={pending}
              onClick={async () => {
                if (expected === undefined || pending) return;
                setPending(true);
                setError(undefined);
                const result = await activate({ deployment, expectedDeployment: expected });
                setPending(false);
                if (Exit.isFailure(result)) {
                  setError(result.cause);
                  return;
                }
                setExpected(undefined);
              }}
            >
              Activate version
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
