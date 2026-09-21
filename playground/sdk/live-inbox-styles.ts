import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
import { Effect, Schema } from "effect";

/** The example's authored stylesheet could not be compiled before deployment. */
export class LiveInboxStylesFailed extends Schema.TaggedError<LiveInboxStylesFailed>()(
  "LiveInboxStylesFailed",
  { cause: Schema.Defect() },
) {}

/** Compile this example's literal utilities before the SDK's ordinary CSS bundle step. */
export const buildLiveInboxStyles = (css: string, uiDirectory: string) =>
  Effect.tryPromise({
    try: async () => {
      const compiler = await compile(css, {
        base: uiDirectory,
        // This is a one-shot build. There is no watcher to register dependencies with.
        onDependency: () => {},
      });
      const scanner = new Scanner({ sources: compiler.sources });
      return compiler.build(scanner.scan());
    },
    catch: (cause) => new LiveInboxStylesFailed({ cause }),
  });
