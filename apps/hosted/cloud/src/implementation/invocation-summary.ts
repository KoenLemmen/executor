/** Native invocation totals include background cleanup; they are not response latency. */
import { Effect, Option, Schema } from "effect";
import {
  CloudInvocation,
  InvocationHttp,
  InvocationPhase,
} from "../contracts/invocation-telemetry.ts";

const phase = Schema.decodeUnknownOption(
  Schema.Union([InvocationPhase, Schema.fromJsonString(InvocationPhase)]),
);
const phaseAttribute = {
  "alchemy.runtime.initialize": "executor.initialize_ms",
  "alchemy.runtime.wait": "executor.runtime_wait_ms",
  "alchemy.response": "executor.response_ready_ms",
  "alchemy.cleanup": "executor.cleanup_ms",
  "alchemy.do.initialize": "executor.do_initialize_ms",
  "alchemy.do.wait": "executor.do_wait_ms",
  "alchemy.do.response": "executor.do_response_ready_ms",
};

/** Produce an explicit, credential-free projection for one platform callback. */
export const invocationSummary = (input: unknown) =>
  Schema.decodeUnknownEffect(CloudInvocation)(input).pipe(
    Effect.map((event) => {
      const attributes: Record<string, string | number | boolean> = {
        "cloudflare.cpu_time_ms": event.cpuTime,
        "cloudflare.wall_time_ms": event.wallTime,
        "cloudflare.outcome": event.outcome,
        "cloudflare.truncated": event.truncated,
      };
      for (const log of event.logs)
        for (const message of log.message) {
          const timing = phase(message);
          if (Option.isSome(timing)) {
            attributes["executor.phase_clock"] = "cloudflare-io";
            attributes[phaseAttribute[timing.value.name]] = timing.value.durationMs;
            if (timing.value.name === "alchemy.runtime.initialize")
              attributes["executor.initialization_observed"] = true;
          }
        }
      if (event.eventTimestamp !== null)
        attributes["cloudflare.event.timestamp_ms"] = event.eventTimestamp;
      if (event.scriptName !== null) attributes["cloudflare.script_name"] = event.scriptName;
      if (event.scriptVersion !== undefined)
        attributes["cloudflare.script_version.id"] = event.scriptVersion.id;
      const http = Schema.decodeUnknownOption(InvocationHttp)(event.event);
      if (Option.isSome(http)) {
        attributes["http.request.method"] = http.value.request.method;
        if (http.value.response !== undefined)
          attributes["http.response.status_code"] = http.value.response.status;
        const ray = http.value.request.headers["cf-ray"];
        if (ray !== undefined && /^[a-f0-9]{16,32}(?:-[A-Z]{3})?$/i.test(ray))
          attributes["cloudflare.ray_id"] = ray.replace(/-[A-Z]{3}$/i, "");
        const trace = http.value.request.headers.traceparent?.match(
          /^00-([a-f0-9]{32})-[a-f0-9]{16}-[a-f0-9]{2}$/,
        )?.[1];
        if (trace !== undefined) attributes["executor.trace_id"] = trace;
      }
      return attributes;
    }),
  );

/** Keep valid events if a future platform payload fails to decode; never log that raw payload. */
export const recordInvocations = (events: ReadonlyArray<unknown>) =>
  Effect.forEach(
    events,
    (event) =>
      invocationSummary(event).pipe(
        Effect.flatMap((attributes) =>
          Effect.logInfo("cloudflare.invocation").pipe(Effect.annotateLogs(attributes)),
        ),
        Effect.catchTag("SchemaError", () =>
          Effect.logError("Invalid Cloudflare invocation timing record"),
        ),
      ),
    { discard: true },
  );
