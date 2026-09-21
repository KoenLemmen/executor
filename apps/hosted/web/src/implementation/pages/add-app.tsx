import { useAtomMount } from "@effect/atom-react";
import { PageSkeleton } from "@executor-js/ui/dashboard/loading";
import { HostedFailure, useDashboardAtoms } from "../components/dashboard-bindings.tsx";
import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@executor-js/ui/components/button";
import { CatalogPage as Catalog, CatalogInstall } from "@executor-js/ui/dashboard/catalog";
import { Empty } from "@executor-js/ui/dashboard/common";
import type { CatalogEntry } from "@executor-js/catalog/contracts";
import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, ArrowLeft02Icon } from "@hugeicons/core-free-icons";
import { useOrganizationRoute } from "../components/organization.tsx";
/** Local's Add flow, with hosted authority and organization-specific navigation. */
export function AddAppPage() {
  const atoms = useDashboardAtoms();
  useAtomMount(atoms.catalog);
  const { role, slug: organizationSlug } = useOrganizationRoute();
  const navigate = useNavigate();
  const [entry, setEntry] = useState<CatalogEntry>();
  if (role === undefined) return <PageSkeleton title="Add app" />;
  if (role === "member")
    return (
      <div className="page w-full shrink-0 max-w-315 [padding:24px_24px_48px] my-0 mx-auto max-[1000px]:[padding:20px_20px_40px] max-[740px]:[padding:18px_max(16px,_env(safe-area-inset-right))_max(32px,_env(safe-area-inset-bottom))_max(16px,_env(safe-area-inset-left))]">
        <Empty title="An admin can add apps">
          <Link to="/org/$organizationSlug/apps" params={{ organizationSlug }}>
            Back to apps
          </Link>
        </Empty>
      </div>
    );
  return entry ? (
    <CatalogInstall
      mutation={atoms.install}
      Failure={HostedFailure}
      key={entry.id}
      entry={entry}
      onBack={() => setEntry(undefined)}
      onInstalled={(app) =>
        navigate({
          to: Object.keys(app.requirements.accounts).length
            ? "/org/$organizationSlug/apps/$appId/setup"
            : "/org/$organizationSlug/apps/$appId",
          params: { organizationSlug, appId: app.id },
        })
      }
    />
  ) : (
    <Catalog
      query={atoms.catalog}
      Failure={HostedFailure}
      onSelect={setEntry}
      back={
        <Link
          to="/org/$organizationSlug/apps"
          params={{ organizationSlug }}
          className="back-link inline-flex gap-1.5 items-center text-[12px] text-muted-foreground mb-4.25 hover:text-foreground max-[740px]:min-h-11 max-[740px]:inline-flex max-[740px]:items-center max-[740px]:-mt-2 max-[740px]:mb-3"
        >
          <HugeiconsIcon icon={ArrowLeft02Icon} size={14} />
          Apps
        </Link>
      }
      action={
        <Button variant="outline" asChild>
          <Link to="/org/$organizationSlug/apps/add/custom" params={{ organizationSlug }}>
            <HugeiconsIcon icon={Add01Icon} size={14} />
            Custom app
          </Link>
        </Button>
      }
    />
  );
}
