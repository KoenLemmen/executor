/** Test-stage commands own deployment policy and child-process lifecycle. */
import { Clock, Config, Console, Effect, Option, Schema } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { TestStageSlug, testStagePrefix } from "../infrastructure/stage.ts";
import {
  stageCapacity,
  stageRetentionStatus,
  testStageLifetimeDays,
  TestStageFailed,
  type StageInventory,
} from "../contracts/test-stage-capacity.ts";
import { withStageAdmin } from "./test-stage-inventory.ts";

const slug = Argument.String("slug").pipe(Argument.withSchema(TestStageSlug));
const owner = Flag.String("owner").pipe(Flag.withSchema(Schema.NonEmptyString), Flag.optional);
const days = Flag.Int("days").pipe(
  Flag.withSchema(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 30 }))),
  Flag.withDefault(testStageLifetimeDays),
);
const json = Flag.Boolean("json").pipe(Flag.withDefault(false));
const failure = (message: string) => new TestStageFailed({ message });

const printInventory = (inventory: StageInventory, json: boolean, deploying?: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const capacity = stageCapacity(inventory, deploying);
    const report = {
      ...inventory,
      ...capacity,
      stages: inventory.stages.map((stage) => ({
        ...stage,
        status: stageRetentionStatus(stage.retention, now),
      })),
    };
    if (json) yield* Console.log(JSON.stringify(report, null, 2));
    else {
      yield* Console.log(
        `Postgres: ${inventory.usedConnections}/${inventory.maxConnections} connections (${inventory.reservedConnections} reserved). Pool budget: ${capacity.configuredConnections}/${capacity.connectionBudget}.`,
      );
      yield* Console.log("STAGE\tCONNECTIONS\tPOOL LIMITS\tRETENTION\tOWNER\tEXPIRES");
      for (const stage of report.stages)
        yield* Console.log(
          [
            stage.slug,
            stage.connections,
            stage.pools.length === 0
              ? "pending (5)"
              : stage.pools.map((pool) => (pool.limit === null ? "unset" : pool.limit)).join("+"),
            stage.status,
            stage.retention === null ? "untracked" : stage.retention.owner,
            stage.retention?.expiresAt === null || stage.retention === null
              ? "-"
              : stage.retention.expiresAt,
          ].join("\t"),
        );
      for (const pool of inventory.otherPools)
        yield* Console.log(
          `Other pool on this branch: ${pool.name} (${pool.limit === null ? "unset" : pool.limit} connections).`,
        );
      for (const reason of capacity.reasons) yield* Console.error(`WARNING: ${reason}`);
      if (report.stages.some((stage) => stage.status === "expired"))
        yield* Console.error(
          "Expired previews need review. Destroy only an explicitly approved slug with test-stage destroy <slug>.",
        );
    }
    return capacity;
  });

const ownerName = (selected: Option.Option<string>) =>
  Effect.gen(function* () {
    if (Option.isSome(selected)) return selected.value;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const name = yield* spawner.string(ChildProcess.make("git", ["config", "user.name"])).pipe(
      Effect.map((name) => name.trim()),
      Effect.mapError(() =>
        failure("Pass --owner or configure git user.name to identify this preview's owner."),
      ),
    );
    return yield* Schema.decodeUnknownEffect(Schema.NonEmptyString)(name).pipe(
      Effect.mapError(() => failure("Pass a non-empty --owner to identify this preview's owner.")),
    );
  });

const runChild = (command: ChildProcess.Command) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const code = Number(yield* spawner.exitCode(command));
    if (code !== 0)
      return yield* Effect.fail(
        failure(`The child command exited with status ${code}. Deployment stopped.`),
      );
  });

const operation = (name: "deploy" | "plan" | "destroy") =>
  Command.make(
    name,
    {
      slug,
      owner,
      days,
      noInput: Flag.Boolean("no-input").pipe(Flag.withDefault(false)),
      yes: Flag.Boolean("yes").pipe(Flag.withDefault(false)),
    },
    (input) =>
      withStageAdmin(name !== "plan", (admin) =>
        Effect.gen(function* () {
          // Destruction must remain possible at capacity, including if the Cloudflare read API is down.
          const inventory = name === "destroy" ? undefined : yield* admin.inventory;
          if (inventory !== undefined) {
            const capacity = yield* printInventory(inventory, false, input.slug);
            if (capacity.reasons.length > 0)
              return yield* Effect.fail(
                failure(
                  "Test-stage capacity check failed. No build or infrastructure changes were started.",
                ),
              );
          }
          const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
          const revision = (yield* spawner.string(
            ChildProcess.make("git", ["rev-parse", "HEAD"]),
          )).trim();
          const version = yield* Config.String("EXECUTOR_BUILD_VERSION").pipe(Config.option);
          const env = {
            ALCHEMY_STAGE: `${testStagePrefix}${input.slug}`,
            EXECUTOR_BUILD_VERSION: Option.isSome(version) ? version.value : revision,
          };
          const stageOwner = name === "deploy" ? yield* ownerName(input.owner) : undefined;
          if (name === "deploy")
            yield* runChild(
              ChildProcess.make("bun", ["run", "framework:build"], {
                env,
                extendEnv: true,
                stdout: "inherit",
                stderr: "inherit",
              }),
            );
          yield* runChild(
            ChildProcess.make(
              "alchemy",
              [name, ...(input.noInput ? ["--no-input"] : []), ...(input.yes ? ["--yes"] : [])],
              {
                env,
                extendEnv: true,
                stdin: "inherit",
                stdout: "inherit",
                stderr: "inherit",
              },
            ),
          );
          if (name === "deploy" && inventory !== undefined && stageOwner !== undefined) {
            const previous = inventory.stages.find((stage) => stage.slug === input.slug)?.retention;
            const now = yield* Clock.currentTimeMillis;
            yield* admin.writeRetention(input.slug, {
              version: 1,
              owner: stageOwner,
              updatedAt: new Date(now).toISOString(),
              expiresAt:
                previous?.expiresAt === null
                  ? null
                  : new Date(now + input.days * 86400000).toISOString(),
            });
            const capacity = yield* printInventory(yield* admin.inventory, false);
            if (capacity.reasons.length > 0)
              return yield* Effect.fail(
                failure(
                  "Deployment finished, but the cluster is above its operating budget. Review the inventory before creating another preview.",
                ),
              );
          }
        }),
      ),
  );

const inspect = (name: "list" | "check") =>
  Command.make(name, { json }, ({ json }) =>
    withStageAdmin(false, (admin) =>
      Effect.gen(function* () {
        const capacity = yield* printInventory(yield* admin.inventory, json);
        if (name === "check" && capacity.reasons.length > 0)
          yield* Effect.sync(() => {
            process.exitCode = 1;
          });
      }),
    ),
  );

const retain = (name: "keep" | "expire") =>
  Command.make(name, { slug, owner, days }, (input) =>
    withStageAdmin(true, (admin) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        yield* admin.writeRetention(input.slug, {
          version: 1,
          owner: yield* ownerName(input.owner),
          updatedAt: new Date(now).toISOString(),
          expiresAt: name === "keep" ? null : new Date(now + input.days * 86400000).toISOString(),
        });
        yield* Console.log(
          name === "keep"
            ? `Keeping ${input.slug} until explicitly released.`
            : `${input.slug} expires in ${input.days} days. No automatic deletion is scheduled.`,
        );
      }),
    ),
  );

/** Parsed commands share the same inventory, capacity policy and deployment lock. */
export const testStageCommand = Command.make("test-stage").pipe(
  Command.withDescription("Deploy isolated previews within the shared Postgres connection budget."),
  Command.withSubcommands([
    inspect("list"),
    inspect("check"),
    operation("plan"),
    operation("deploy"),
    operation("destroy"),
    retain("keep"),
    retain("expire"),
  ]),
);
