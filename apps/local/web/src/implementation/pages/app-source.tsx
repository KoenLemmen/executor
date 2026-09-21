import { DeploymentId } from "@executor-js/sdk";
import type { DashboardApp } from "@executor-js/local-server/contracts";
import { useMemo, useState } from "react";
import { sourceAtom } from "../../contracts/api.ts";
import { AppSource as SharedAppSource } from "@executor-js/ui/dashboard/app-source";
import { Failure } from "../components/common.tsx";

/** Inspect immutable source versions; choosing a version never changes the active deployment. */
export function AppSource({ data }: { readonly data: DashboardApp }) {
  const [selectedDeployment, setSelectedDeployment] = useState<DeploymentId | undefined>(undefined);
  const deployment = selectedDeployment ?? data.app.activeDeployment;
  const query = useMemo(
    () => sourceAtom({ app: data.app.id, deployment }),
    [data.app.id, deployment],
  );
  return (
    <SharedAppSource
      app={data.app}
      deployments={data.deployments}
      deployment={deployment}
      selectedDeployment={selectedDeployment}
      onDeploymentChange={setSelectedDeployment}
      query={query}
      Failure={Failure}
    />
  );
}
