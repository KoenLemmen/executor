/** Static source assets shared by the ordinary local and hosted Executor app templates. */
import { SourceFile } from "@executor-js/sdk/core";
import { Effect, FileSystem, Path } from "effect";
import { TemplateError } from "../contracts/templates.ts";

/** Attach the guide as an ordinary deployed skill file. Deploy validates its frontmatter. */
export const executorSkillFiles = (authoring: string): readonly SourceFile[] => [
  SourceFile.make({ path: "skills/app-authoring/SKILL.md", content: authoring }),
];

/** Node hosts read the package asset at setup; Workers provide the same text through their bundle. */
export const readExecutorSkills = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const filename = yield* path.fromFileUrl(
    new URL(
      import.meta.resolve("@executor-js/app-templates/executor/skills/app-authoring/SKILL.md"),
    ),
  );
  return executorSkillFiles(yield* fs.readFileString(filename));
}).pipe(
  Effect.mapError(
    () => new TemplateError({ reason: "The Executor authoring skill could not be loaded." }),
  ),
);
