import { createHash } from "node:crypto";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Result } from "effect";

import { makeInMemoryBlobStore } from "./blob";
import { makeSkillPackageRepository } from "./skill-package-repository";

const bytes = new TextEncoder().encode("valid skill content");
const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const file = {
  path: "SKILL.md",
  size: bytes.byteLength,
  digest,
  mediaType: "text/markdown",
  encoding: "base64" as const,
};

describe("skill package repository", () => {
  it.effect("refuses to copy invalid historical blobs into another owner", () =>
    Effect.gen(function* () {
      for (const stored of ["not base64!", btoa("short"), btoa("wrong skill content")]) {
        const blobs = makeInMemoryBlobStore();
        const packages = makeSkillPackageRepository(blobs);
        yield* blobs.put("source/skills", digest, stored);
        yield* blobs.put("destination/skills", digest, btoa("existing destination"));

        const result = yield* packages.copy("source", "destination", [file]).pipe(Effect.result);
        expect(Result.isFailure(result)).toBe(true);
        expect(yield* blobs.get("destination/skills", digest)).toBe(btoa("existing destination"));
      }
    }),
  );
});
