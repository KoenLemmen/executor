/** Resolve catalog choices into ordinary app source; installation belongs to the caller. */
import { Effect } from "effect";
import { CatalogImportFailed, type Catalog, type CatalogSource } from "../contracts/catalog.ts";
import { generateApp } from "./generate.ts";
import { generateMcpApp } from "./mcp.ts";
import { applyCatalogOverride } from "./overrides.ts";
import { catalogSource } from "./source.ts";

/** Use integrations.sh by default, or supply a source. Construction performs no I/O. */
export const createCatalog = (source: CatalogSource = catalogSource): Catalog => {
  const list = source.list.pipe(
    Effect.flatMap((entries) => Effect.forEach(entries, applyCatalogOverride)),
  );
  return {
    list,
    prepare: (input) =>
      Effect.gen(function* () {
        const entry = (yield* list).find((entry) => entry.id === input.entry);
        if (entry === undefined)
          return yield* new CatalogImportFailed({
            reason: "This entry is no longer in the catalog. Refresh and choose another app.",
          });
        const generated =
          entry.kind === "mcp"
            ? yield* generateMcpApp(entry, input.mcpAuth)
            : yield* source
                .document(entry)
                .pipe(Effect.flatMap((document) => generateApp(entry, document)));
        return { files: generated.files };
      }),
  };
};
