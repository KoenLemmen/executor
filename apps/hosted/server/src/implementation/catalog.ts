/** Supply shared catalog reads and source preparation to hosted handlers. */
import { CatalogImportFailed, createCatalog } from "@executor-js/catalog";
import type { SourceFile } from "@executor-js/sdk/core";
import { Effect, Layer } from "effect";
import { HostedCatalog } from "../contracts/catalog.ts";
import { Authentication } from "../contracts/auth.ts";
import { executorAppSource, executorCatalogEntry } from "./executor-app.ts";

/** Fetch the public integrations.sh feed on request. Layer construction performs no network I/O. */
export const catalogLive = (skills: readonly SourceFile[]) =>
  Layer.effect(
    HostedCatalog,
    Effect.gen(function* () {
      const { origin } = yield* Authentication;
      const published = createCatalog();
      const executor = executorCatalogEntry(origin);
      return HostedCatalog.of({
        list: published.list.pipe(
          Effect.map((entries) => [
            executor,
            ...entries.filter((entry) => entry.id !== executor.id),
          ]),
        ),
        prepare: (input) =>
          input.entry === executor.id
            ? executorAppSource(origin, skills).pipe(
                Effect.map(({ files }) => ({ files })),
                Effect.mapError((error) => new CatalogImportFailed({ reason: error.reason })),
              )
            : published.prepare(input),
      });
    }),
  );
