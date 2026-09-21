import { browserReturnTo } from "@executor-js/hosted-server/browser/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { useAtomRefresh, useAtomSet, useAtomValue } from "@effect/atom-react";
import { Cause, Exit } from "effect";
import { HugeiconsIcon } from "@hugeicons/react";
import { GithubIcon } from "@hugeicons/core-free-icons";
import { useEffect, useState, type ReactNode } from "react";
import { AuthFailed, sessionAtom, signInAtom } from "../../contracts/auth.ts";
import { Button } from "@executor-js/ui/components/button";
import { Spinner } from "@executor-js/ui/components/spinner";
import { productTitle, useDocumentTitle } from "@executor-js/ui/hooks/document-title";

const callbackError = (error: unknown): string | null => {
  if (typeof error !== "string" || error === "") return null;
  if (error === "access_denied") return "Sign-in was canceled. You can try again.";
  if (error === "account_not_linked" || error === "unable_to_link_account")
    return "This email is not linked to this sign-in method. Contact an administrator.";
  return "Sign-in could not be completed. Please try again.";
};

/** Preserve internal return paths and render only known, safe OAuth error messages. */
export const loginSearch = (
  search: Record<string, unknown>,
): { redirect: string; error?: string } => {
  const error =
    typeof search.error === "string" && search.error !== "" ? { error: search.error } : {};
  return { redirect: browserReturnTo(search.redirect), ...error };
};

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
      <path
        fill="#4285F4"
        d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z"
      />
      <path
        fill="#34A853"
        d="M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.97-3.38.97-2.6 0-4.82-1.76-5.61-4.13H3.04v2.59A10 10 0 0 0 12 22Z"
      />
      <path
        fill="#FBBC05"
        d="M6.39 13.92a6 6 0 0 1 0-3.84V7.49H3.04a10 10 0 0 0 0 9.02l3.35-2.59Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.95c1.47 0 2.79.51 3.83 1.51l2.87-2.87A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.96 5.49l3.35 2.59A5.99 5.99 0 0 1 12 5.95Z"
      />
    </svg>
  );
}

/** Cloud social sign-in, composed with additional cloud credentials. */
export function LoginPage({
  redirect,
  error: callbackCode,
  children,
}: ReturnType<typeof loginSearch> & { readonly children?: ReactNode }) {
  useDocumentTitle(productTitle("Sign in"));
  const callbackFailure = callbackError(callbackCode);
  const session = useAtomValue(sessionAtom);
  const refreshSession = useAtomRefresh(sessionAtom);
  const signIn = useAtomSet(signInAtom, { mode: "promiseExit" });
  const state = useAtomValue(signInAtom);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<"google" | "github" | null>(null);
  const signedIn = AsyncResult.isSuccess(session) && !session.waiting && session.value !== null;
  // A signed OAuth return URL must not be parsed and reserialized by the router.
  useEffect(() => {
    if (signedIn) window.location.replace(redirect);
  }, [signedIn, redirect]);
  if (AsyncResult.isFailure(session))
    return (
      <div className="auth-pending min-h-dvh flex items-center justify-center gap-4">
        <p>Unable to check your session.</p>
        <Button variant="outline" onClick={refreshSession}>
          Try again
        </Button>
      </div>
    );
  if (signedIn || session.waiting || AsyncResult.isInitial(session))
    return (
      <div className="auth-pending min-h-dvh flex items-center justify-center gap-4">
        <Spinner />
      </div>
    );
  const start = async (provider: "google" | "github") => {
    setError(null);
    setProvider(provider);
    const result = await signIn({ provider, redirect });
    if (Exit.isFailure(result)) {
      const error = Cause.squash(result.cause);
      setError(error instanceof AuthFailed ? error.message : "Unable to start sign-in. Try again.");
      setProvider(null);
    }
  };
  return (
    <main className="auth-page flex flex-col min-h-dvh items-center justify-center p-[24px]">
      <section className="auth-form w-full max-w-85 flex flex-col gap-6 [&_form]:flex [&_form]:flex-col [&_form]:gap-4 [&_label]:flex [&_label]:flex-col [&_label]:gap-1.75 [&_label]:text-[13px] [&_label]:font-medium [&_input]:h-10.5 [&_form_>_button]:min-h-10.5 [&_.wordmark]:p-0 [&_.wordmark]:h-8 [&_.wordmark]:min-h-8 [&_.wordmark]:w-auto [&_.wordmark]:justify-start">
        <div className="wordmark flex items-center gap-2 h-12 py-0 px-[8px] font-mono text-[15px] font-medium [&_img]:w-5.25 [&_img]:h-5.25 max-[740px]:p-0 max-[740px]:w-11 max-[740px]:h-11 max-[740px]:justify-center max-[740px]:shrink-0 max-[740px]:[&_>_span]:hidden">
          <img src="/favicon.png" alt="" />
          executor
        </div>
        <h1 className="text-[22px] font-semibold tracking-[-0.035em] leading-[1.35] [&>span]:text-muted-foreground [&>span]:text-[13px] [&>span]:font-mono [&>span]:font-normal [&>span]:ml-[8px] [&>span]:align-middle">
          Sign in to Executor
        </h1>
        <div className="social-login flex flex-col gap-3 [&_button]:h-11 [&_button]:gap-3">
          <Button
            variant="outline"
            disabled={state.waiting}
            loading={state.waiting && provider === "google"}
            onClick={() => start("google")}
          >
            <GoogleIcon />
            Continue with Google
          </Button>
          <Button
            variant="outline"
            disabled={state.waiting}
            loading={state.waiting && provider === "github"}
            onClick={() => start("github")}
          >
            <HugeiconsIcon icon={GithubIcon} strokeWidth={2} aria-hidden size={18} />
            Continue with GitHub
          </Button>
        </div>
        {children}
        {(error || callbackFailure) && (
          <p className="auth-error text-destructive text-[13px]" role="alert">
            {error || callbackFailure}
          </p>
        )}
      </section>
    </main>
  );
}

/** Product hosts provide their own legal URLs because cloud and self-host differ. */
export function LoginLegalFooter({
  privacyUrl,
  termsUrl,
}: {
  readonly privacyUrl: string;
  readonly termsUrl: string;
}) {
  return (
    <p className="auth-legal mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
      <a href={privacyUrl}>Privacy</a>
      <span aria-hidden>·</span>
      <a href={termsUrl}>Terms</a>
    </p>
  );
}
