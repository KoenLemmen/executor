import { Empty } from "@executor-js/ui/components/empty";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { OrganizationId } from "@executor-js/hosted-server/organization";
import { Exit } from "effect";
import { useState } from "react";
import { acceptInvitationAtom } from "../../contracts/organization.ts";
import { organizationError, OrganizationDestination } from "../components/organization.tsx";
import { Button } from "@executor-js/ui/components/button";

/** Invitation IDs are untrusted; Better Auth verifies recipient email and expiry. */
export const inviteSearch = (search: Record<string, unknown>) => ({
  invitation: typeof search.invitation === "string" ? search.invitation : "",
});
/** Accept after authentication, including users who have no organization yet. */
export function InvitePage({ invitation }: { readonly invitation: string }) {
  const accept = useAtomSet(acceptInvitationAtom, { mode: "promiseExit" });
  const state = useAtomValue(acceptInvitationAtom);
  const [joined, setJoined] = useState<OrganizationId>();
  const [error, setError] = useState<string | null>(null);
  if (joined) return <OrganizationDestination organization={joined} />;
  return (
    <section className="page w-full shrink-0 max-w-315 [padding:24px_24px_48px] my-0 mx-auto max-[1000px]:[padding:20px_20px_40px] max-[740px]:[padding:18px_max(16px,_env(safe-area-inset-right))_max(32px,_env(safe-area-inset-bottom))_max(16px,_env(safe-area-inset-left))]">
      <Empty className="empty-state min-h-77.5 flex flex-col justify-center items-center text-center p-[32px] text-muted-foreground border border-border rounded-[8px] [&_h2]:text-[14px] [&_h2]:text-foreground [&_h2]:font-medium [&_h2]:[margin:15px_0_5px] [&_p]:text-[12px] [&_p]:max-w-85 [&_a]:underline [&_a]:underline-offset-[3px] max-[740px]:min-h-62.5 max-[740px]:py-[24px] max-[740px]:px-[18px] max-[740px]:[&_a]:inline-flex max-[740px]:[&_a]:items-center max-[740px]:[&_a]:min-h-11">
        <h1 className="text-[22px] font-semibold tracking-[-0.035em] leading-[1.35] [&>span]:text-muted-foreground [&>span]:text-[13px] [&>span]:font-mono [&>span]:font-normal [&>span]:ml-[8px] [&>span]:align-middle">
          Join an organization
        </h1>
        <p>
          {invitation
            ? "Accept this invitation with the email it was sent to."
            : "This invitation link is incomplete."}
        </p>
        {error && (
          <p className="auth-error text-destructive text-[13px]" role="alert">
            {error}
          </p>
        )}
        <Button
          disabled={!invitation || state.waiting}
          onClick={async () => {
            setError(null);
            const result = await accept(invitation);
            if (Exit.isFailure(result)) setError(organizationError(result.cause));
            else setJoined(result.value);
          }}
        >
          Accept invitation
        </Button>
      </Empty>
    </section>
  );
}
