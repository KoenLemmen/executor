import { ExecutorDevtools } from "@executor-js/devtools";
import { createRootRoute, Outlet } from "@tanstack/react-router";
import { PageError, PageNotFound } from "@executor-js/hosted-web/route-fallbacks";
import { AuthBoundary } from "@executor-js/hosted-web/auth";
import { OrganizationResumeBoundary } from "@executor-js/hosted-web/organization";
import { useLocation } from "@tanstack/react-router";
import { hostedPageTitle } from "@executor-js/hosted-web/contracts/navigation";
import { DocumentTitleProvider, productTitle } from "@executor-js/ui/hooks/document-title";

/** Global auth, invitation and callback routes have no selected organization. */
export const Route = createRootRoute({
  component: Root,
  notFoundComponent: PageNotFound,
  errorComponent: PageError,
});

function Root() {
  const { pathname } = useLocation();
  return (
    <DocumentTitleProvider fallbackTitle={productTitle(hostedPageTitle(pathname))}>
      <AuthBoundary>
        <OrganizationResumeBoundary>
          <Outlet />
        </OrganizationResumeBoundary>
      </AuthBoundary>
      <ExecutorDevtools />
    </DocumentTitleProvider>
  );
}
