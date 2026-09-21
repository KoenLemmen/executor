/** Host-authorized, bounded OTLP ingestion. Authentication/origin policy stays with the product. */
import { ByteSize, Effect } from "effect";
import { HttpIncomingMessage, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { forwardTelemetry } from "./relay.ts";

/** Forward browser events to the host's private destination. Call only after authorizing the origin. */
export const receiveBrowserTelemetry = (signal: "traces" | "logs", build?: string) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (!request.headers["content-type"]?.startsWith("application/json"))
      return HttpServerResponse.empty({ status: 415 });
    const body = yield* request.text.pipe(
      Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.kibibytes(256)),
    );
    yield* forwardTelemetry(
      {
        traces: signal === "traces" ? [body] : [],
        logs: signal === "logs" ? [body] : [],
        dropped: 0,
      },
      undefined,
      build,
      "executor-web",
    );
    return HttpServerResponse.empty({ status: 202, headers: { "cache-control": "no-store" } });
  }).pipe(
    Effect.catchTags({
      SchemaError: () => Effect.succeed(HttpServerResponse.empty({ status: 400 })),
      HttpClientError: () => Effect.succeed(HttpServerResponse.empty({ status: 502 })),
      TimeoutError: () => Effect.succeed(HttpServerResponse.empty({ status: 504 })),
    }),
  );
