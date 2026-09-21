import { Link } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import { Settings05Icon } from "@hugeicons/core-free-icons";
import type { ReactNode } from "react";
import { DashboardShell as SharedShell } from "@executor-js/ui/dashboard/shell";
import { OrganizationSwitcher, useOrganizationRoute } from "./organization.tsx";
import { SessionMenu } from "./auth.tsx";

/** Organization and session controls belong to the hosted product, outside the shared shell. */
export function DashboardShell({
  navigation,
  children,
  allowCreateOrganization = true,
}: {
  readonly navigation: ReactNode;
  readonly children: ReactNode;
  readonly allowCreateOrganization?: boolean;
}) {
  const { slug: organizationSlug } = useOrganizationRoute();
  return (
    <SharedShell
      brand={
        <Link
          to="/org/$organizationSlug/apps"
          params={{ organizationSlug }}
          className="wordmark flex items-center gap-2 h-12 py-0 px-[8px] font-mono text-[15px] font-medium [&_img]:w-5.25 [&_img]:h-5.25 max-[740px]:p-0 max-[740px]:w-11 max-[740px]:h-11 max-[740px]:justify-center max-[740px]:shrink-0 max-[740px]:[&_>_span]:hidden"
        >
          <img src="/favicon.png" alt="" />
          <span>executor</span>
        </Link>
      }
      identity={<OrganizationSwitcher allowCreate={allowCreateOrganization} />}
      navigation={
        <>
          {navigation}
          <Link
            to="/org/$organizationSlug/organization"
            params={{ organizationSlug }}
            activeProps={{ className: "active", "aria-current": "page" }}
          >
            <HugeiconsIcon icon={Settings05Icon} strokeWidth={2} size={16} aria-hidden />
            Settings
          </Link>
        </>
      }
      footer={
        <div className="hosted-identity w-full py-0 px-[4px] [&_.session-menu]:border-t [&_.session-menu]:border-t-border">
          <OrganizationSwitcher allowCreate={allowCreateOrganization} />
          <SessionMenu />
        </div>
      }
    >
      {children}
    </SharedShell>
  );
}
