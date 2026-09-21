import { SourceFiles, type SourceFile } from "@executor-js/sdk/core";
import { Effect } from "effect";
/** Executor uses the same source generator, provider accounts and deployments as other API apps. */
import { CatalogEntry } from "@executor-js/catalog/contracts";
import { compileOpenApi, generateOpenApiApp } from "@executor-js/app-templates";
import type { HostedApiDocument } from "../contracts/api.ts";

/** This installation's public API, available as an ordinary OpenAPI app. */
export const executorCatalogEntry = (origin: string) =>
  CatalogEntry.make({
    id: `${origin}/openapi.json`,
    kind: "openapi",
    name: "Executor",
    description: "Manage apps and connected accounts in Executor.",
    domain: new URL(origin).hostname,
    connectUrl: `${origin}/openapi.json`,
    oauthDiscoveryUrl: `${origin}/api`,
    feeds: ["curated"],
  });

/** The catalog retains the ordinary OAuth connection for explicitly installed copies. */
export const executorAppSource = (
  origin: string,
  skills: readonly SourceFile[],
  document: HostedApiDocument,
) =>
  generateOpenApiApp(executorCatalogEntry(origin), document, { baseUrl: origin }).pipe(
    Effect.map((generated) => ({
      ...generated,
      files: SourceFiles.make([...generated.files, ...skills]),
    })),
  );

/** The default app accepts a saved user API key through the ordinary secrets method. */
export const defaultExecutorAppSource = (
  origin: string,
  skills: readonly SourceFile[],
  document: HostedApiDocument,
) =>
  compileOpenApi(executorCatalogEntry(origin), document, { baseUrl: origin }).pipe(
    Effect.map((metadata) => ({
      files: SourceFiles.make([
        {
          path: "index.ts",
          content: `import { defineApp } from "apps";
import { openapiOperations } from "apps/openapi";
import { provider } from "./provider.ts";
import metadata from "./operations.json";

export default defineApp({ accounts: { service: provider } }, async (context) => ({
  name: "Executor",
  ...await openapiOperations({
    ...metadata,
    account: context.accounts.service,
    fetch: context.fetch,
    ...(context.signal === undefined ? {} : { signal: context.signal }),
  }),
}));
`,
        },
        {
          path: "provider.ts",
          content: `import { defineProvider, object, string, secrets, oauth2 } from "apps";

export const provider = defineProvider({ name: "Executor", auth: {
  apiKey: secrets({ label: "Executor API key", fields: object({ token: string(), organization: string() }) }),
  oauth: oauth2({ discover: ${JSON.stringify(`${origin}/api`)} }),
} });
`,
        },
        {
          path: "operations.json",
          content: JSON.stringify(
            {
              ...metadata,
              methods: {
                ...metadata.methods,
                apiKey: [
                  {
                    scheme: "oauth",
                    field: "token",
                    in: "header",
                    name: "Authorization",
                    prefix: "Bearer ",
                  },
                  {
                    scheme: "oauth",
                    field: "organization",
                    in: "header",
                    name: "X-Executor-Organization",
                    prefix: "",
                  },
                ],
              },
            },
            null,
            2,
          ),
        },
        ...skills,
      ]),
    })),
  );
