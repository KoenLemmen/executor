// ---------------------------------------------------------------------------
// Retry a direct Postgres call while the server refuses new connections.
//
// The deploy's out-of-band scripts (`scripts/migrate.ts`,
// `scripts/ensure-workos-mirror-ready.ts`) open ONE direct connection to
// production Postgres, bypassing Hyperdrive. When every non-superuser slot is
// taken — Hyperdrive's pools after a Worker redeploy, an operator session, a
// second CI job — the server answers the connect with SQLSTATE 53300
// (`too_many_connections`, "remaining connection slots are reserved for roles
// with the SUPERUSER attribute") before a single statement runs. Nothing was
// applied, the slots free up within minutes, and a plain rerun of the deploy
// passed. So that specific refusal is retried on a fixed cadence for a few
// minutes; every other failure (a bad migration, a lost network) surfaces
// unchanged on the first attempt.
// ---------------------------------------------------------------------------

import { Effect, Result, Schedule } from "effect";

/** SQLSTATE `too_many_connections`: the server's connection ceiling is reached. */
export const TOO_MANY_CONNECTIONS_SQLSTATE = "53300";

// postgres.js sets the SQLSTATE as a string `code`; Drizzle wraps that in its
// own "Failed query" error with the driver error in `.cause`. Walk the chain
// (bounded) rather than inspect one level.
const MAX_CAUSE_DEPTH = 8;

export const isTooManyConnectionsError = (failure: unknown): boolean => {
  let current: unknown = failure;
  for (
    let depth = 0;
    depth < MAX_CAUSE_DEPTH && typeof current === "object" && current !== null;
    depth++
  ) {
    if ((current as { readonly code?: unknown }).code === TOO_MANY_CONNECTIONS_SQLSTATE) {
      return true;
    }
    current = (current as { readonly cause?: unknown }).cause;
  }
  return false;
};

/** 8 retries, 30 seconds apart: about four minutes of waiting for a slot. */
export const TOO_MANY_CONNECTIONS_RETRIES = 8;
export const TOO_MANY_CONNECTIONS_RETRY_INTERVAL = "30 seconds";

export const TOO_MANY_CONNECTIONS_RETRY_SCHEDULE = Schedule.both(
  Schedule.spaced(TOO_MANY_CONNECTIONS_RETRY_INTERVAL),
  Schedule.recurs(TOO_MANY_CONNECTIONS_RETRIES),
);

export type RetryWhileTooManyConnectionsOptions = {
  /** Overrides the production cadence; tests pass a delay-free schedule. */
  readonly schedule?: Schedule.Schedule<unknown, unknown>;
  /** Called on every refused attempt (including the last), before the wait. */
  readonly onRefused?: (failure: unknown, attempt: number) => void;
};

/**
 * Run `run`, retrying only while it fails with SQLSTATE 53300. Never rejects:
 * resolves with the first success, or with the ORIGINAL failure — the
 * non-53300 error from the first attempt, or the last 53300 refusal once the
 * schedule is spent — for the calling script to rethrow at its boundary.
 */
export const retryWhileTooManyConnections = <A>(
  run: () => Promise<A>,
  options: RetryWhileTooManyConnectionsOptions = {},
): Promise<Result.Result<A, unknown>> => {
  const schedule = options.schedule ?? TOO_MANY_CONNECTIONS_RETRY_SCHEDULE;
  let attempts = 0;
  // `Effect.retry` retries every failure it sees, so only the 53300 refusal is
  // left in the error channel; any other failure is lifted out as a value and
  // ends the loop on the spot.
  const attempt = Effect.suspend(() => {
    attempts += 1;
    return Effect.tryPromise({ try: run, catch: (cause) => cause }).pipe(
      Effect.result,
      Effect.flatMap((outcome) =>
        Result.isFailure(outcome) && isTooManyConnectionsError(outcome.failure)
          ? Effect.flatMap(
              Effect.sync(() => options.onRefused?.(outcome.failure, attempts)),
              () => Effect.fail(outcome.failure),
            )
          : Effect.succeed(outcome),
      ),
    );
  });
  // Two nested Results: the outer one is "the retries ran out on 53300", the
  // inner one is "the first attempt failed with something else". Both are the
  // caller's failure; flatten them.
  return Effect.runPromise(
    attempt.pipe(
      Effect.retry(schedule),
      Effect.result,
      Effect.map((retried) =>
        Result.isFailure(retried) ? Result.fail(retried.failure) : retried.success,
      ),
    ),
  );
};
