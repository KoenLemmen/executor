import { useLocation } from "@tanstack/react-router";
import { InventoryPageSkeleton, PageSkeleton } from "@executor-js/ui/dashboard/loading";

/** Lazy pages load inside the existing organization layout with the destination's content shape. */
export function PagePending() {
  const { pathname } = useLocation();
  if (/\/apps\/?$/.test(pathname)) return <InventoryPageSkeleton kind="apps" />;
  if (/\/accounts\/?$/.test(pathname)) return <InventoryPageSkeleton kind="accounts" />;
  const title = /\/organization\/?$/.test(pathname)
    ? "Organization settings"
    : /\/apps\/add/.test(pathname)
      ? "Add app"
      : /\/accounts\//.test(pathname)
        ? "Account"
        : /\/apps\//.test(pathname)
          ? "App"
          : /\/connect\/?$/.test(pathname)
            ? "Connect"
            : "Executor";
  return <PageSkeleton title={title} />;
}
