/** Startup failures are safe to display; transport payloads and keys stay out of diagnostics. */
import { Schema } from "effect";
import { Command, Flag } from "effect/unstable/cli";

/** One explicit startup stage failed without exposing its raw input. */
export class StartupFailed extends Schema.TaggedError<StartupFailed>()("StartupFailed", {
  stage: Schema.Literals(["desktop-bootstrap", "listen", "browser", "pair", "dev-server"]),
}) {}
/** Entry modes share a server implementation; desktop receives a private bootstrap pipe. */
export type LaunchMode = "browser" | "headless" | "pair" | "desktop";

/** CLI declarations parse before handlers acquire configuration or server resources. */
export const executorCommand = Command.make("executor", {
  bootstrapFd: Flag.Literals("bootstrap-fd", ["3"]).pipe(
    Flag.withDescription("Read the desktop bootstrap envelope from fd3"),
    Flag.optional,
    Flag.withHidden,
  ),
}).pipe(
  Command.withDescription(
    "Start the local server and open its dashboard. Configure EXECUTOR_API_KEY and EXECUTOR_ENCRYPTION_KEY in the environment.",
  ),
);

/** Start the same server without opening a browser. */
export const serveCommand = Command.make("serve").pipe(
  Command.withDescription("Start without opening a browser"),
);

/** Pair with an existing server without opening local storage. */
export const pairCommand = Command.make("pair").pipe(
  Command.withDescription("Print a new connection link for the running server"),
);
