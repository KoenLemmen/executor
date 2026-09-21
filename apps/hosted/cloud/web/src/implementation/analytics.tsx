/** Cloud-only product analytics, sharing the marketing site's PostHog project. */
import posthog from "posthog-js";
import { useAtomValue } from "@effect/atom-react";
import { sessionAtom } from "@executor-js/hosted-web/contracts/auth";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect } from "react";

let started = false;

const deploymentProperties = () => ({
  product_version: "v2",
  surface: "dashboard",
  environment: import.meta.env.VITE_EXECUTOR_ENVIRONMENT,
  release: import.meta.env.VITE_EXECUTOR_RELEASE,
  executor_test: String(import.meta.env.VITE_EXECUTOR_ENVIRONMENT).startsWith("test-"),
});

/** Initialize explicit event capture at the browser entry point. */
export const startAnalytics = () => {
  const key: unknown = import.meta.env.VITE_POSTHOG_KEY;
  if (typeof key !== "string" || key.length === 0) return;
  const path: unknown = import.meta.env.VITE_POSTHOG_PATH;
  if (typeof path !== "string" || !/^\/api\/[a-f0-9]{16}$/.test(path))
    throw new Error("PostHog proxy path is missing from this build");
  posthog.init(key, {
    defaults: "2025-05-24",
    // Keep SDK identity/attribution, but deliver analytics without vendor URL fingerprints.
    before_send: (event) => {
      if (event) {
        try {
          const body = new Blob([JSON.stringify(event)], { type: "application/json" });
          if (!navigator.sendBeacon(`${path}/push`, body))
            console.warn("Could not queue analytics event");
        } catch {
          console.warn("Could not encode analytics event");
        }
      }
      // This adapter owns delivery; the SDK must not send the same event again.
      return null;
    },
    api_host: `${location.origin}${path}`,
    ui_host: import.meta.env.VITE_POSTHOG_HOST,
    autocapture: false,
    property_denylist: ["$current_url", "$initial_current_url", "$referrer", "$initial_referrer"],
    capture_pageview: false,
    capture_pageleave: false,
    capture_exceptions: false,
    disable_session_recording: true,
    persistence: "localStorage",
    person_profiles: "identified_only",
  });
  posthog.register(deploymentProperties());
  started = true;
};

/** Record resolved SPA navigation without OAuth codes, search parameters or fragments. */
export const capturePageview = (pathname: string) => {
  if (started)
    posthog.capture("$pageview", {
      $current_url: `${location.origin}${pathname}`,
      $pathname: pathname,
    });
};

/** Identify only confirmed sessions; reset persisted identity after confirmed sign-out. */
export function AnalyticsIdentity() {
  const session = useAtomValue(sessionAtom);
  useEffect(() => {
    if (!started || !AsyncResult.isSuccess(session) || session.waiting) return;
    if (session.value !== null) {
      if (posthog.get_distinct_id() !== session.value.user.id)
        posthog.identify(session.value.user.id);
    } else if (posthog.get_property("$user_id")) {
      posthog.reset();
      posthog.register(deploymentProperties());
    }
  }, [session]);
  return null;
}
