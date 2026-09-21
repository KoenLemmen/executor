import { AccountsPage as SharedPage } from "@executor-js/ui/dashboard/accounts";
import { HostedFailure, useDashboardAtoms } from "../components/dashboard-bindings.tsx";

/** Account links lead to the shared detail view; the host supplies management authority. */
export function AccountsPage() {
  return <SharedPage query={useDashboardAtoms().inventory} Failure={HostedFailure} />;
}
