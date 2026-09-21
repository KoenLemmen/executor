/** Capacity policy for the shared preview cluster; production keeps its own settings. */
import { Schema } from "effect";

/** Hyperdrive's minimum configurable origin limit. It remains a soft limit. */
export const testStageConnectionLimit = 5;
/** Initial operating limit, including quiet and retained stages. */
export const testStageLimit = 10;
/** Keep 30 percent free for internal sessions, deployments and pool overshoot. */
export const testStageWarningRatio = 0.7;
/** New previews expire after three days; expiry never authorizes deletion. */
export const testStageLifetimeDays = 3;

const Timestamp = Schema.String.check(
  Schema.makeFilter((value) => Number.isFinite(Date.parse(value)), {
    message: "Expected an ISO timestamp",
  }),
);

/** Only comments with this versioned shape are owned by the stage command. */
export const StageRetention = Schema.Struct({
  version: Schema.Literal(1),
  owner: Schema.NonEmptyString,
  updatedAt: Timestamp,
  expiresAt: Schema.NullOr(Timestamp),
});
/** A null expiry means the stage must be explicitly kept. */
export type StageRetention = typeof StageRetention.Type;

/** Public inventory contains no origin credentials or SQL text. */
export interface StageInventory {
  readonly maxConnections: number;
  readonly reservedConnections: number;
  readonly usedConnections: number;
  readonly stages: ReadonlyArray<{
    readonly slug: string;
    readonly database: string;
    readonly connections: number;
    readonly pools: ReadonlyArray<{ readonly name: string; readonly limit: number | null }>;
    readonly retention: StageRetention | null;
  }>;
  /** Other Hyperdrive origins on this branch also consume the shared budget. */
  readonly otherPools: ReadonlyArray<{ readonly name: string; readonly limit: number | null }>;
}

/** A deploy must fail before provisioning when capacity cannot be established. */
export class TestStageFailed extends Schema.TaggedError<TestStageFailed>()("TestStageFailed", {
  message: Schema.String,
}) {}

/** Conservative capacity projection counts dormant pools and unfinished databases. */
export const stageCapacity = (inventory: StageInventory, deploying?: string) => {
  const exists = inventory.stages.some((stage) => stage.slug === deploying);
  const isNew = deploying !== undefined && !exists;
  const pools = [...inventory.stages.flatMap((stage) => stage.pools), ...inventory.otherPools];
  const unknownPools = pools.filter((pool) => pool.limit === null).map((pool) => pool.name);
  // A failed deploy can leave a database before its Hyperdrive is created.
  const configuredConnections =
    pools.reduce((sum, pool) => sum + (pool.limit === null ? 0 : pool.limit), 0) +
    inventory.stages.filter((stage) => stage.pools.length === 0).length * testStageConnectionLimit;
  const projectedConnections = configuredConnections + (isNew ? testStageConnectionLimit : 0);
  const usableConnections = inventory.maxConnections - inventory.reservedConnections;
  const connectionBudget = Math.floor(usableConnections * testStageWarningRatio);
  const reasons: string[] = [];
  if (unknownPools.length > 0)
    reasons.push(`Set explicit connection limits for: ${unknownPools.join(", ")}.`);
  if (inventory.stages.length + (isNew ? 1 : 0) > testStageLimit)
    reasons.push(
      `The shared cluster permits ${testStageLimit} retained previews. Review old stages first.`,
    );
  if (projectedConnections > connectionBudget)
    reasons.push(
      `Pools would target ${projectedConnections} connections; the preview budget is ${connectionBudget}.`,
    );
  if (inventory.usedConnections >= connectionBudget)
    reasons.push(
      `The cluster uses ${inventory.usedConnections} connections; the warning threshold is ${connectionBudget}.`,
    );
  return { configuredConnections, projectedConnections, connectionBudget, reasons };
};

/** Expiration marks a review candidate and never implies permission to destroy it. */
export const stageRetentionStatus = (retention: StageRetention | null, now: number) =>
  retention === null
    ? "untracked"
    : retention.expiresAt === null
      ? "keep"
      : Date.parse(retention.expiresAt) <= now
        ? "expired"
        : "temporary";
