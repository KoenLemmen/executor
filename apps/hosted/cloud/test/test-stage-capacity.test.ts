/** Capacity decisions count quiet stages and leave room for operational connections. */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  stageCapacity,
  stageRetentionStatus,
  type StageInventory,
} from "../src/contracts/test-stage-capacity.ts";

const inventory = (count: number): StageInventory => ({
  maxConnections: 100,
  reservedConnections: 3,
  usedConnections: 20,
  otherPools: [],
  stages: Array.from({ length: count }, (_, i) => ({
    slug: `preview-${i}`,
    database: `executor_preview_${i}`,
    connections: 0,
    pools: [{ name: `pool-${i}`, limit: 5 }],
    retention: null,
  })),
});

test("quiet previews consume budget; the eleventh is refused while a redeploy remains possible", () => {
  assert.deepEqual(stageCapacity(inventory(9), "new").reasons, []);
  assert.equal(stageCapacity(inventory(9), "new").projectedConnections, 50);
  assert.match(stageCapacity(inventory(10), "new").reasons.join(" "), /10 retained/);
  assert.deepEqual(stageCapacity(inventory(10), "preview-0").reasons, []);
});

test("the old 25-slot cluster fails the budget even with no active queries", () => {
  const result = stageCapacity({ ...inventory(8), maxConnections: 25, usedConnections: 3 });
  assert.equal(result.configuredConnections, 40);
  assert.match(result.reasons.join(" "), /preview budget is 15/);
});

test("unknown limits, duplicate pools, unrelated origins on the branch, and partial deploys cannot disappear from capacity", () => {
  const base = inventory(0);
  const report: StageInventory = {
    ...base,
    stages: [
      { slug: "partial", database: "executor_partial", connections: 0, pools: [], retention: null },
      {
        slug: "duplicate",
        database: "executor_duplicate",
        connections: 0,
        pools: [
          { name: "a", limit: 5 },
          { name: "b", limit: 20 },
        ],
        retention: null,
      },
    ],
    otherPools: [
      { name: "unrelated", limit: 30 },
      { name: "unset", limit: null },
    ],
  };
  assert.equal(stageCapacity(report).configuredConnections, 60);
  assert.match(stageCapacity(report).reasons.join(" "), /unset/);
  assert.equal(stageCapacity(report, "partial").projectedConnections, 60);
});

test("check warns at 70 percent of usable connections", () => {
  assert.deepEqual(stageCapacity({ ...inventory(1), usedConnections: 66 }).reasons, []);
  assert.match(
    stageCapacity({ ...inventory(1), usedConnections: 67 }).reasons.join(" "),
    /warning threshold/,
  );
});

test("expiry is distinct from retained and untracked previews", () => {
  const now = Date.parse("2026-01-02T00:00:00Z");
  const metadata = {
    version: 1 as const,
    owner: "fixture",
    updatedAt: "2026-01-01T00:00:00Z",
    expiresAt: null,
  };
  assert.equal(stageRetentionStatus(null, now), "untracked");
  assert.equal(stageRetentionStatus(metadata, now), "keep");
  assert.equal(
    stageRetentionStatus({ ...metadata, expiresAt: "2026-01-02T00:00:00Z" }, now),
    "expired",
  );
  assert.equal(
    stageRetentionStatus({ ...metadata, expiresAt: "2026-01-03T00:00:00Z" }, now),
    "temporary",
  );
});
