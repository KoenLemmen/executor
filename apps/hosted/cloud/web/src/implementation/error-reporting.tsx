/** Cloud browser error reporting with explicit deployment identity and no session replay. */
import * as Sentry from "@sentry/react";
import { useAtomValue } from "@effect/atom-react";
import { sessionAtom } from "@executor-js/hosted-web/contracts/auth";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect } from "react";

/** Call once at the browser composition root; unconfigured local builds remain disabled. */
export const startErrorReporting = () => {
  const dsn: unknown = import.meta.env.VITE_SENTRY_DSN;
  if (typeof dsn !== "string" || dsn.length === 0) return;
  const tunnel: unknown = import.meta.env.VITE_SENTRY_TUNNEL;
  if (typeof tunnel !== "string" || !/^\/api\/[a-f0-9]{16}\/submit$/.test(tunnel))
    throw new Error("Sentry tunnel path is missing from this build");
  Sentry.init({
    tunnel,
    dsn,
    environment: import.meta.env.VITE_EXECUTOR_ENVIRONMENT,
    release: import.meta.env.VITE_EXECUTOR_RELEASE,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    initialScope: { tags: { product_version: "v2" } },
    beforeSend: (event) => {
      if (event.request) {
        delete event.request.cookies;
        delete event.request.headers;
        delete event.request.data;
        if (event.request.url) {
          const url = new URL(event.request.url);
          url.search = "";
          url.hash = "";
          event.request.url = url.href;
        }
      }
      return event;
    },
  });
};

/** Keep Sentry's user context aligned with confirmed sign-in and sign-out state. */
export function ErrorReportingIdentity() {
  const session = useAtomValue(sessionAtom);
  useEffect(() => {
    if (AsyncResult.isSuccess(session) && !session.waiting)
      Sentry.setUser(session.value ? { id: session.value.user.id } : null);
  }, [session]);
  return null;
}

const reportReactError = (error: unknown, info: { componentStack?: string | undefined }) =>
  Sentry.reactErrorHandler()(
    error,
    info.componentStack === undefined ? {} : { componentStack: info.componentStack },
  );

/** React 19 forwards caught and uncaught failures; normalize its optional stack at the SDK boundary. */
export const reactErrorHandlers = {
  onUncaughtError: reportReactError,
  onCaughtError: reportReactError,
  onRecoverableError: reportReactError,
};
