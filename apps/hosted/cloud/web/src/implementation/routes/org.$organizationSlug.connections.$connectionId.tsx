import { createFileRoute } from "@tanstack/react-router";
import { ConnectAccountPage } from "@executor-js/hosted-web/pages/connect-account";

export const Route = createFileRoute("/org/$organizationSlug/connections/$connectionId")({
  component: () => <ConnectAccountPage connectionId={Route.useParams().connectionId} />,
});
