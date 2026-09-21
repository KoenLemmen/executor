import { createFileRoute } from "@tanstack/react-router";
import { AccountsPage } from "@executor-js/hosted-web/pages/accounts";

/** Hosted account inventory. */
export const Route = createFileRoute("/org/$organizationSlug/accounts/")({
  component: AccountsPage,
});
