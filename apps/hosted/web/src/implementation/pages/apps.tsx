import { Skeleton } from "@executor-js/ui/components/skeleton";
import { HostedFailure, useDashboardAtoms } from "../components/dashboard-bindings.tsx";
import { AppsPage as SharedPage } from "@executor-js/ui/dashboard/apps";
import { Button } from "@executor-js/ui/components/button";
import { Link } from "@tanstack/react-router";
import { useOrganizationRoute } from "../components/organization.tsx";
/** Permission to show this action belongs to the hosted product. The API also enforces it. */
export function AppsPage() {
  const atoms = useDashboardAtoms();
  const { role, slug: organizationSlug } = useOrganizationRoute();
  return (
    <SharedPage
      query={atoms.inventory}
      Failure={HostedFailure}
      action={
        role === undefined ? (
          <Skeleton className="h-9 w-22 rounded-md" aria-label="Loading app actions" />
        ) : (
          (role === "owner" || role === "admin") && (
            <Button asChild>
              <Link to="/org/$organizationSlug/apps/add" params={{ organizationSlug }}>
                Add app
              </Link>
            </Button>
          )
        )
      }
    />
  );
}
