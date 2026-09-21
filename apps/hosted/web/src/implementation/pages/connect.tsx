import { Link } from "@tanstack/react-router";
import { useOrganizationRoute } from "../components/organization.tsx";
import {
  ConnectPage as ConnectPageView,
  McpInstallInstructions,
} from "@executor-js/ui/dashboard/connect";

/** Hosted clients can use browser OAuth or a personal access token. */
export function ConnectPage() {
  const organization = useOrganizationRoute();
  return (
    <ConnectPageView>
      <McpInstallInstructions endpoint={`${window.location.origin}/mcp`}>
        Connect from your client (use /mcp in Claude Code) to open Executor in your browser. Sign
        in, choose an organization, and approve the connection.
      </McpInstallInstructions>
      <p className="mt-4 text-sm text-muted-foreground">
        To connect with a token,{" "}
        <Link
          className="underline underline-offset-4"
          to="/org/$organizationSlug/api-keys"
          params={{ organizationSlug: organization.slug }}
        >
          create a personal access token
        </Link>{" "}
        and use the MCP config shown there.
      </p>
    </ConnectPageView>
  );
}
