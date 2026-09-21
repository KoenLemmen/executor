/** Cloud browser error reporting with explicit deployment identity and no session replay. */
import * as Sentry from "@sentry/react";
import { useAtomValue } from "@effect/atom-react";
import { sessionAtom } from "@executor-js/hosted-web/contracts/auth";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect } from "react";

/**
 * OAuth codes, MCP authorization parameters and invitation tokens all travel in
 * the query string or fragment of a first-visit URL. Nothing carrying one may
 * reach Sentry, from a request URL or from a navigation, fetch or xhr breadcrumb.
 */
export const strippedUrl = (value: string): string => {
  const url = URL.parse(value, "https://executor.invalid");
  if (url === null) return value;
  url.search = "";
  url.hash = "";
  return url.origin === "https://executor.invalid" ? url.pathname : url.href;
};

/** Breadcrumb URLs live in `data`; the SDK records them as relative paths with a query. */
export const strippedBreadcrumb = <A extends { data?: Record<string, unknown> | undefined }>(
  crumb: A,
): A => {
  const data = crumb.data;
  if (data === undefined) return crumb;
  for (const key of ["from", "to", "url"]) {
    const value = data[key];
    if (typeof value === "string") data[key] = strippedUrl(value);
  }
  return crumb;
};

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
    // Breadcrumbs are attached before this hook runs, so they are scrubbed here too.
    beforeBreadcrumb: (crumb) => strippedBreadcrumb(crumb),
    beforeSend: (event) => {
      if (event.request) {
        delete event.request.cookies;
        delete event.request.headers;
        delete event.request.data;
        if (event.request.url) event.request.url = strippedUrl(event.request.url);
      }
      if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.map(strippedBreadcrumb);
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
