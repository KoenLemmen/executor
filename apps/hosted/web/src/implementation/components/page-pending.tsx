import { Skeleton } from "@executor-js/ui/components/skeleton";
import { useLocation } from "@tanstack/react-router";
import { InventoryPageSkeleton, PageSkeleton } from "@executor-js/ui/dashboard/loading";

/** Lazy pages load inside the existing organization layout with the destination's content shape. */
export function PagePending({ pathname: destination }: { readonly pathname?: string } = {}) {
  const location = useLocation();
  const pathname = destination ?? location.pathname;
  if (/\/apps\/?$/.test(pathname))
    return (
      <InventoryPageSkeleton
        kind="apps"
        action={<Skeleton className="h-9 w-22 rounded-md" aria-label="Loading app actions" />}
      />
    );
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
