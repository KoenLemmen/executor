/** Exercise supervisor leases over real workerd RPC, including a call beyond the native gate deadline. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { Miniflare } from "miniflare";
import { bundleHarness } from "./bundle.ts";

const facet = `import { DurableObject } from "cloudflare:workers";
export class ExecutorAppData extends DurableObject {
  instance = crypto.randomUUID();
  calls = new Map();
  async invoke(id, body) {
    const controller = new AbortController();
    this.calls.set(id, controller);
    try {
      const input = JSON.parse(body);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, input.delay);
        controller.signal.addEventListener("abort", () => { clearTimeout(timer); reject(new Error("cancelled")); }, { once: true });
      });
      return { ok: true, value: { instance: this.instance, id } };
    } finally { this.calls.delete(id); }
  }
  cancel(id) { this.calls.get(id)?.abort(); }
}`;

test(
  "long calls do not hold the DO event gate; replacement drains leases and cancellation targets one call",
  { timeout: 50_000 },
  async () => {
    const mf = new Miniflare({
      name: "lifetime",
      modules: true,
      script: await bundleHarness(facet),
      compatibilityDate: "2026-07-30",
      bindings: { TEST_TOKEN: "test-only" },
      workerLoaders: { LOADER: {} },
      durableObjects: { ROOT: { className: "Supervisor", useSQLite: true } },
    });
    const request = (path: string, body?: object) =>
      mf.dispatchFetch(`https://test${path}`, {
        method: "POST",
        headers: { authorization: "Bearer test-only" },
        body: JSON.stringify(body ?? {}),
      });
    try {
      const initial = await request("/data?app=a&version=v1", { write: false, delay: 0 });
      const first = await initial.json();
      const started = Date.now();
      const long = request("/data?app=a&version=v1&request=long", { write: false, delay: 31_500 });
      const cancelled = request("/data?app=a&version=v1&request=cancelled", {
        write: true,
        delay: 60_000,
      });
      await new Promise((resolve) => setTimeout(resolve, 100));
      const fast = await request("/data?app=a&version=v1", { write: false, delay: 0 });
      assert.equal(fast.status, 200);
      assert.ok(Date.now() - started < 5_000);
      let replaced = false;
      const replacement = request("/data?app=a&version=v2", { write: false, delay: 0 }).then(
        (response) => {
          replaced = true;
          return response;
        },
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal(replaced, false);
      assert.equal((await request("/cancel?app=a&request=cancelled")).status, 200);
      assert.equal((await cancelled).status, 500);
      assert.equal(replaced, false);
      const completed = await long;
      assert.equal(completed.status, 200, await completed.clone().text());
      assert.ok(Date.now() - started > 30_000);
      const after = await replacement;
      assert.equal(after.status, 200);
      assert.notDeepEqual(await after.json(), first);
    } finally {
      await mf.dispose();
    }
  },
);
