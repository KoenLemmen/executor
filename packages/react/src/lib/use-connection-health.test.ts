import { beforeEach, describe, expect, it } from "@effect/vitest";
import {
  AuthTemplateSlug,
  ConnectionAddress,
  ConnectionName,
  IntegrationSlug,
  ProviderKey,
  type Connection,
  type HealthCheckResult,
} from "@executor-js/sdk/shared";

import {
  AUTO_PROBE_FLOOR_MS,
  HEALTH_REVALIDATE_MS,
  clearAutomaticProbeMemory,
  autoProbeRetryDelayMs,
  probeMemoryKey,
  probePersisted,
  recordAutomaticProbe,
  resetAutomaticProbeMemoryForTest,
  revalidateQuery,
  shouldAutoProbe,
} from "./use-connection-health";

const verdict = (status: HealthCheckResult["status"]): HealthCheckResult => ({
  status,
  checkedAt: Date.now(),
});

const githubDefault: Connection = {
  owner: "org",
  name: ConnectionName.make("default"),
  integration: IntegrationSlug.make("github"),
  template: AuthTemplateSlug.make("default"),
  provider: ProviderKey.make("default"),
  address: ConnectionAddress.make("tools.github.org.default"),
  identityLabel: null,
  expiresAt: null,
};

describe("revalidateQuery", () => {
  it("defers a healthy verdict to the server-enforced freshness window", () => {
    expect(revalidateQuery(verdict("healthy")).ifStaleMs, "the healthy window is sent").toBe(
      HEALTH_REVALIDATE_MS,
    );
  });

  // The load-bearing case, and the reason this cannot become a short window.
  // Every non-healthy verdict is PERSISTED, so a request carrying `ifStaleMs`
  // would be answered from the row the previous probe wrote — "still expired" —
  // and the dot could not turn green until the window elapsed. Omitting the
  // window is what makes recovery show on the next load.
  it.each(["expired", "degraded", "unknown"] as const)(
    "forces a fresh probe for a %s verdict, so recovery shows on the next load",
    (status) => {
      expect(
        revalidateQuery(verdict(status)).ifStaleMs,
        "a non-healthy verdict must not be answered from the persisted verdict",
      ).toBeUndefined();
    },
  );

  it("forces a fresh probe for a never-checked connection too", () => {
    expect(revalidateQuery(null).ifStaleMs, "a cleared verdict probes").toBeUndefined();
    expect(revalidateQuery(undefined).ifStaleMs, "a never-seen one probes").toBeUndefined();
  });

  // An OAuth re-mint clears the persisted verdict, and the hook re-arms on that
  // clearing transition. If the resulting request carried a window it could be
  // answered from a verdict a pre-reconnect probe raced in afterwards, and the
  // reconnected row would keep reading Expired.
  it("never sends a window for anything but a healthy verdict", () => {
    const windows = (["expired", "degraded", "unknown"] as const).map(
      (status) => revalidateQuery(verdict(status)).ifStaleMs,
    );
    expect(windows, "only the healthy path is gated").toEqual([undefined, undefined, undefined]);
  });
});

// shouldAutoProbe consults module-scope memory (see automaticProbeMemory in
// use-connection-health.ts), so every test starts from a clean slate and uses
// a fresh key to avoid cross-test interference even under parallel execution.
describe("shouldAutoProbe", () => {
  beforeEach(() => {
    resetAutomaticProbeMemoryForTest();
  });

  it("probes on first sight, with no persisted verdict and no memory", () => {
    expect(shouldAutoProbe("acme:github:default", null, Date.now())).toBe(true);
  });

  it("does not re-probe a second time inside the floor, even for an expired verdict", () => {
    const key = "acme:github:expired-in-floor";
    const now = Date.now();
    recordAutomaticProbe(key, { status: "expired", checkedAt: now });

    expect(
      shouldAutoProbe(key, verdict("expired"), now + AUTO_PROBE_FLOOR_MS - 1),
      "a remount inside the floor must not re-arm the probe",
    ).toBe(false);
  });

  it("probes again once the floor has elapsed, for a non-healthy verdict", () => {
    const key = "acme:github:expired-after-floor";
    const now = Date.now();
    recordAutomaticProbe(key, { status: "expired", checkedAt: now });

    expect(
      shouldAutoProbe(key, verdict("expired"), now + AUTO_PROBE_FLOOR_MS + 1),
      "the floor elapsing re-arms the probe so recovery can still show",
    ).toBe(true);
  });

  it("suppresses a remembered healthy result younger than HEALTH_REVALIDATE_MS, even past the floor", () => {
    const key = "acme:github:healthy-remembered";
    const now = Date.now();
    recordAutomaticProbe(key, { status: "healthy", checkedAt: now });

    expect(
      shouldAutoProbe(key, { status: "healthy", checkedAt: now }, now + AUTO_PROBE_FLOOR_MS + 1),
      "a fresh healthy verdict must not probe just because the floor elapsed",
    ).toBe(false);
  });

  it("probes again once a remembered healthy result ages past HEALTH_REVALIDATE_MS", () => {
    const key = "acme:github:healthy-stale";
    const now = Date.now();
    recordAutomaticProbe(key, { status: "healthy", checkedAt: now });

    expect(
      shouldAutoProbe(key, null, now + HEALTH_REVALIDATE_MS + 1),
      "a healthy verdict must revalidate once it goes stale",
    ).toBe(true);
  });

  it("re-arms when the persisted verdict was cleared while unmounted, inside the floor", () => {
    // An OAuth reconnect clears `last_health` server-side. If that landed
    // while the row was unmounted, the remount's first sight sees `null`
    // against a remembered pre-reconnect verdict: that IS the clearing
    // transition, and it must fire the recovery probe despite the floor.
    const key = "u|org|org:github:default";
    recordAutomaticProbe(key, verdict("expired"));
    expect(shouldAutoProbe(key, null, Date.now() + 1_000)).toBe(true);
  });

  it("does not treat a never-persisted verdict as a reconnect clear", () => {
    // A plugin with no health probe answers `unknown` and the server persists
    // nothing, so `persisted` stays `null` for that connection forever. That
    // is not a clearing transition: the floor must still apply, or every
    // remount would re-probe.
    const key = "u|org|org:noprobe:default";
    const now = Date.now();
    recordAutomaticProbe(key, { status: "unknown", checkedAt: now }, { persisted: false });
    expect(shouldAutoProbe(key, null, now + 1_000)).toBe(false);
    expect(shouldAutoProbe(key, null, now + AUTO_PROBE_FLOOR_MS + 1)).toBe(true);
  });

  it("treats a cleared PERSISTED unknown verdict as a reconnect clear", () => {
    // A plugin health check can legitimately answer `unknown`, and the server
    // persists that. If a reconnect then clears it while the row is
    // unmounted, the remount must probe: the status alone cannot tell the
    // two `unknown`s apart, only whether the server held a verdict.
    const key = "u|org|org:flaky:default";
    const now = Date.now();
    recordAutomaticProbe(key, { status: "unknown", checkedAt: now }, { persisted: true });
    expect(shouldAutoProbe(key, null, now + 1_000)).toBe(true);
  });

  it("keys the memory by identity, so two orgs' same-named connections do not collide", () => {
    const a = probeMemoryKey("user_1|org_a", githubDefault);
    const b = probeMemoryKey("user_1|org_b", githubDefault);
    expect(a).not.toBe(b);
    recordAutomaticProbe(a, verdict("healthy"));
    expect(shouldAutoProbe(a, verdict("healthy"))).toBe(false);
    expect(shouldAutoProbe(b, verdict("expired"))).toBe(true);
  });

  it("re-arms immediately once the entry is cleared, ignoring the floor", () => {
    const key = "acme:github:cleared";
    const now = Date.now();
    recordAutomaticProbe(key, { status: "expired", checkedAt: now });
    expect(shouldAutoProbe(key, verdict("expired"), now + 1), "still inside the floor").toBe(false);

    clearAutomaticProbeMemory(key);

    expect(
      shouldAutoProbe(key, null, now + 1),
      "clearing the memory re-arms the probe even inside the floor",
    ).toBe(true);
  });
});

describe("probePersisted", () => {
  it("is true whenever the row already held a verdict before the probe", () => {
    expect(probePersisted(verdict("unknown"), verdict("healthy"))).toBe(true);
    expect(probePersisted(verdict("unknown"), verdict("expired"))).toBe(true);
  });

  it("on a row with no verdict, infers from the status: only unknown may be unpersisted", () => {
    // The server's no-capability path is the only one that answers without
    // writing, and it always answers `unknown`. A plugin probe that answers
    // `unknown` on a first-ever check IS persisted, so this is a conservative
    // guess for that case: the floor applies, and the retry timer bounds it.
    expect(probePersisted(verdict("healthy"), null)).toBe(true);
    expect(probePersisted(verdict("expired"), undefined)).toBe(true);
    expect(probePersisted(verdict("unknown"), null)).toBe(false);
  });
});

describe("autoProbeRetryDelayMs", () => {
  beforeEach(() => {
    resetAutomaticProbeMemoryForTest();
  });

  it("is null with no memory and null once the floor has elapsed", () => {
    const key = "u|org|org:github:retry";
    const now = Date.now();
    expect(autoProbeRetryDelayMs(key, now)).toBeNull();
    recordAutomaticProbe(key, verdict("expired"));
    expect(autoProbeRetryDelayMs(key, now + AUTO_PROBE_FLOOR_MS + 1)).toBeNull();
  });

  it("is the time left on the floor while it is suppressing", () => {
    const key = "u|org|org:github:retry";
    recordAutomaticProbe(key, verdict("expired"));
    const delay = autoProbeRetryDelayMs(key, Date.now() + 10_000);
    expect(delay).not.toBeNull();
    expect(delay!).toBeGreaterThan(AUTO_PROBE_FLOOR_MS - 10_000 - 50);
    expect(delay!).toBeLessThanOrEqual(AUTO_PROBE_FLOOR_MS - 10_000);
  });
});
