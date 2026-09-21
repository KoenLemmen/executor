/** Error-only Sentry integration with one client and isolated scope per Worker request. */
import { CloudflareClient, Scope, createTransport } from "@sentry/cloudflare";
import { createStackParser, nodeStackLineParser } from "@sentry/core";
import { CurrentRuntimeContext } from "alchemy/RuntimeContext";
import { Cause, Context, Effect, ErrorReporter, Option, Schema } from "effect";

// Match Sentry's Cloudflare parser: Worker module names are relative, while
// uploaded release artifacts use root-relative paths.
const [stackPriority, parseStackLine] = nodeStackLineParser();
const workerStackParser = createStackParser([
  stackPriority,
  (line) => {
    const frame = parseStackLine(line);
    if (!frame) return frame;
    return {
      ...frame,
      ...(frame.filename === undefined
        ? {}
        : { abs_path: frame.filename.startsWith("/") ? frame.filename : `/${frame.filename}` }),
      in_app: frame.filename !== undefined,
    };
  },
]);

const Settings = Schema.Struct({
  dsn: Schema.String,
  environment: Schema.String,
  release: Schema.String,
});
/** The reporting boundary never replaces the failure of a product operation. */
export class SentryTransportFailed extends Schema.TaggedError<SentryTransportFailed>()(
  "SentryTransportFailed",
  {},
) {}
interface Reporter {
  readonly capture: (cause: Cause.Cause<unknown>) => Effect.Effect<void>;
}
const Reporter = Context.Reference<Reporter>("cloud/SentryReporter", {
  defaultValue: () => ({ capture: () => Effect.void }),
});

/** Capture a handled Effect failure before an API or runtime adapter translates it. */
export const reportCloudFailure = (cause: Cause.Cause<unknown>) =>
  Effect.flatMap(Reporter, (reporter) => reporter.capture(cause));

/** Build a request-local client; Effect/Alchemy owns the final flush through waitUntil. */
export const withCloudSentry = <A, E, R>(
  handler: Effect.Effect<A, E, R>,
  settings: Effect.Effect<unknown>,
) =>
  Effect.gen(function* () {
    const value = yield* settings;
    if (value === undefined || value === null) return yield* handler;
    const config = yield* Schema.decodeUnknownEffect(Settings)(value).pipe(Effect.orDie);
    const client = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const client = new CloudflareClient({
          ...config,
          integrations: [],
          tracesSampleRate: 0,
          sendDefaultPii: false,
          stackParser: workerStackParser,
          transport: (options) =>
            createTransport(options, async (request) => {
              const response = await fetch(options.url, {
                method: "POST",
                body:
                  typeof request.body === "string" ? request.body : new Uint8Array(request.body),
                ...(options.headers === undefined ? {} : { headers: options.headers }),
              });
              await response.arrayBuffer();
              return {
                statusCode: response.status,
                headers: {
                  "x-sentry-rate-limits": response.headers.get("x-sentry-rate-limits"),
                  "retry-after": response.headers.get("retry-after"),
                },
              };
            }),
        });
        client.init();
        return client;
      }),
      (client) =>
        Effect.tryPromise({
          try: () => client.flush(2000),
          catch: () => new SentryTransportFailed(),
        }).pipe(
          Effect.flatMap((flushed) =>
            flushed ? Effect.void : Effect.logWarning("Sentry error export timed out"),
          ),
          Effect.catch(() => Effect.logWarning("Sentry error export failed")),
          Effect.ensuring(Effect.sync(() => client.dispose())),
        ),
    );
    const seen = new Set<unknown>();
    const capture = (cause: Cause.Cause<unknown>) =>
      Effect.gen(function* () {
        if (Cause.hasInterruptsOnly(cause)) return;
        const exception = Cause.squash(cause);
        // Expected failures such as HttpServerError.RouteNotFound mark themselves
        // ignored; internet scanners probing arbitrary paths must not page Sentry.
        if (ErrorReporter.isIgnored(exception)) return;
        if (seen.has(exception)) return;
        seen.add(exception);
        const scope = new Scope();
        scope.setClient(client);
        scope.setTag("product_version", "v2");
        scope.setTag(
          "executor_test",
          config.environment.startsWith("test-") || config.environment === "verification",
        );
        const span = yield* Effect.currentSpan.pipe(Effect.option);
        if (Option.isSome(span))
          scope.setContext("trace", { trace_id: span.value.traceId, span_id: span.value.spanId });
        client.captureException(exception, undefined, scope);
      });
    return yield* handler.pipe(
      Effect.tapCause(capture),
      Effect.provideService(Reporter, { capture }),
    );
  });

/** Resolve the binding accessor at initialization, preserving native Alchemy event context. */
export const cloudSentry = Effect.gen(function* () {
  const context = yield* CurrentRuntimeContext;
  const settings = context ? context.get<unknown>("EXECUTOR_SENTRY") : Effect.succeed(undefined);
  return <A, E, R>(handler: Effect.Effect<A, E, R>) => withCloudSentry(handler, settings);
});
