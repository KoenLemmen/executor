import { useOrganizationRoute } from "./organization.tsx";
import { Link } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import { BoxesIcon, Key01Icon, Plug01Icon, Shield01Icon } from "@hugeicons/core-free-icons";

const items = [
  { to: "/org/$organizationSlug/connect", label: "Connect", icon: Plug01Icon },
  { to: "/org/$organizationSlug/apps", label: "Apps", icon: BoxesIcon },
  { to: "/org/$organizationSlug/accounts", label: "Accounts", icon: Key01Icon },
  { to: "/org/$organizationSlug/approvals", label: "Approvals", icon: Shield01Icon },
] as const;

/** Common links that hosts compose with their own navigation. */
export function HostedNavigation() {
  const { slug: organizationSlug, role } = useOrganizationRoute();
  return (
    <>
      {items
        .filter((item) => item.label !== "Approvals" || (role !== undefined && role !== "member"))
        .map(({ to, label, icon }) => (
          <Link
            key={to}
            to={to}
            params={{ organizationSlug }}
            activeProps={{ className: "active", "aria-current": "page" }}
          >
            <HugeiconsIcon icon={icon} strokeWidth={2} size={16} aria-hidden />
            {label}
          </Link>
        ))}
    </>
  );
}
