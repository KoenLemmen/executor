import {
  ConnectPage as ConnectPageView,
  McpInstallInstructions,
} from "@executor-js/ui/dashboard/connect";

/** Hosted clients sign in through browser OAuth instead of copying a credential. */
export function ConnectPage() {
  return (
    <ConnectPageView>
      <McpInstallInstructions endpoint={`${window.location.origin}/mcp`}>
        Connect from your client (use /mcp in Claude Code) to open Executor in your browser. Sign
        in, choose an organization, and approve the connection.
      </McpInstallInstructions>
    </ConnectPageView>
  );
}
