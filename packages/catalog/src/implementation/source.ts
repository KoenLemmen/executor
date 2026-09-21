/** Network adapter for the public, read-only integrations.sh feed and API documents. */
import { Effect, Schema } from "effect";
import { FetchHttpClient, HttpClient } from "effect/unstable/http";
import {
  CatalogFeed,
  CatalogImportFailed,
  CatalogUnavailable,
  type CatalogSource,
} from "../contracts/catalog.ts";
const read = (url: string) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const response = yield* client.pipe(HttpClient.filterStatusOk).get(url);
    const text = yield* response.text;
    if (text.length > 20_000_000)
      return yield* Effect.fail(
        new CatalogImportFailed({ reason: "This API definition exceeds the 20 MB import limit." }),
      );
    return text;
  }).pipe(Effect.timeout("30 seconds"), Effect.provide(FetchHttpClient.layer));

/** Download a JSON/YAML document. Products remain responsible for allowed network destinations. */
export const readApiDocument = (url: string) =>
  Effect.gen(function* () {
    const text = yield* read(url).pipe(
      Effect.mapError(
        () =>
          new CatalogImportFailed({
            reason: "The API definition could not be downloaded. Check its URL and try again.",
          }),
      ),
    );
    const { parseDocument } = yield* Effect.promise(() => import("yaml"));
    return yield* Effect.try({
      try: () => {
        const document = parseDocument(text);
        if (document.errors.length) throw new Error("Invalid API document");
        return document.toJS({ maxAliasCount: 100 });
      },
      catch: () =>
        new CatalogImportFailed({ reason: "The API definition is not valid JSON or YAML." }),
    });
  });

/** Fetch only published GET endpoints; this never invokes the registry's discovery agent. */
export const catalogSource: CatalogSource = {
  list: read("https://integrations.sh/api.json").pipe(
    Effect.flatMap((text) => Schema.decodeUnknownEffect(Schema.fromJsonString(CatalogFeed))(text)),
    Effect.map((feed) => feed.data),
    Effect.mapError(() => new CatalogUnavailable()),
  ),
  document: (entry) =>
    Effect.gen(function* () {
      if (entry.kind !== "openapi" || entry.connectUrl === undefined)
        return yield* new CatalogImportFailed({
          reason: "Only entries with an OpenAPI definition can be imported today.",
        });
      const connectUrl = entry.connectUrl;
      const url = yield* Effect.try({
        try: () => new URL(connectUrl),
        catch: () =>
          new CatalogImportFailed({ reason: "This entry has an invalid API definition URL." }),
      });
      if (url.protocol !== "https:" || url.username || url.password)
        return yield* new CatalogImportFailed({
          reason: "The catalog must provide a public HTTPS definition URL.",
        });
      return yield* readApiDocument(url.href);
    }),
};
