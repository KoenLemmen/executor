#!/usr/bin/env node
/** CLI composition root. Platform dependencies and raw process arguments stop here. */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Console, Effect, Option } from "effect";
import { CliError, Command } from "effect/unstable/cli";
import { executorCommand, pairCommand, serveCommand } from "./contracts/startup.ts";
import { launch } from "./implementation/launcher.ts";

const cli = executorCommand.pipe(
  Command.withHandler(({ bootstrapFd }) =>
    launch(Option.isSome(bootstrapFd) ? "desktop" : "browser", process.platform),
  ),
  Command.withSubcommands([
    serveCommand.pipe(Command.withHandler(() => launch("headless", process.platform))),
    pairCommand.pipe(Command.withHandler(() => launch("pair", process.platform))),
  ]),
);

NodeRuntime.runMain(
  Command.run(cli, { version: "0.0.0" }).pipe(
    Effect.scoped,
    Effect.provide(NodeServices.layer),
    // Effect CLI renders argument errors and supplies the exit status for help.
    // Operational failures retain the launcher's sanitized message.
    Effect.catch((error) =>
      CliError.isCliError(error)
        ? Effect.fail(error)
        : Console.error(
            "Executor could not start. Check the configured keys and whether the port is already in use.",
          ).pipe(
            Effect.andThen(
              Effect.sync(() => {
                process.exitCode = 1;
              }),
            ),
          ),
    ),
  ),
);
