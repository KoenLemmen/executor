import { Link } from "@tanstack/react-router";
import { Button } from "@executor-js/ui/components/button";
import { AppAccounts as SharedAccounts } from "@executor-js/ui/dashboard/app-accounts";
import type { App } from "@executor-js/sdk";
import type { DashboardAccount } from "@executor-js/local-server/contracts";
/** Local routes own account management and reconnect destinations. */
export function AppAccounts({
  app,
  accounts,
}: {
  readonly app: App;
  readonly accounts: readonly DashboardAccount[];
}) {
  return (
    <SharedAccounts
      app={app}
      accounts={accounts}
      chooseAction={
        <Button variant="outline" size="sm" asChild>
          <Link to="/apps/$appId/setup" params={{ appId: app.id }}>
            Choose accounts
          </Link>
        </Button>
      }
      reconnectAction={(account) => (
        <Button variant="outline" size="sm" asChild>
          <Link to="/accounts/$accountId/credentials" params={{ accountId: account.id }}>
            Reconnect
          </Link>
        </Button>
      )}
    />
  );
}
