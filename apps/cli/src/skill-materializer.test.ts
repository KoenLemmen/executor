import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { ManagedSkillId, SkillPackageDigest } from "@executor-js/sdk/shared";

import { materializeSkills, SKILL_MARKER_FILENAME } from "./skill-materializer";

const bytes = new TextEncoder().encode("managed contents\n");
const fileDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const skill = {
  id: ManagedSkillId.make("skl_test"),
  owner: "user" as const,
  name: "safe-skill",
  revisionDigest: SkillPackageDigest.make("sha256:package"),
  files: [{ path: "SKILL.md", digest: fileDigest, bytes }],
};

describe("skill materializer", () => {
  it("preserves drift unless forced and keeps unknown files", async () => {
    const root = await mkdtemp(join(tmpdir(), "executor-skills-"));
    try {
      const first = await materializeSkills({
        root,
        origin: "https://executor.example",
        skills: [skill],
        force: false,
      });
      expect(first.added).toBe(1);
      const directory = join(root, skill.name);
      await writeFile(join(directory, "SKILL.md"), "local edit\n");
      await writeFile(join(directory, "notes.txt"), "keep me\n");

      const skipped = await materializeSkills({
        root,
        origin: "https://executor.example",
        skills: [skill],
        force: false,
      });
      expect(skipped.skipped).toEqual(["safe-skill has local changes: SKILL.md"]);
      expect(await readFile(join(directory, "SKILL.md"), "utf8")).toBe("local edit\n");

      const forced = await materializeSkills({
        root,
        origin: "https://executor.example",
        skills: [skill],
        force: true,
      });
      expect(forced.updated).toBe(1);
      expect(await readFile(join(directory, "SKILL.md"), "utf8")).toBe("managed contents\n");
      expect(await readFile(join(directory, "notes.txt"), "utf8")).toBe("keep me\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("removes only unchanged generated files when a skill is no longer enabled", async () => {
    const root = await mkdtemp(join(tmpdir(), "executor-skills-"));
    try {
      await materializeSkills({
        root,
        origin: "https://executor.example",
        skills: [skill],
        force: false,
      });
      const directory = join(root, skill.name);
      await writeFile(join(directory, "notes.txt"), "keep me\n");
      const removed = await materializeSkills({
        root,
        origin: "https://executor.example",
        skills: [],
        force: false,
      });
      expect(removed.removed).toBe(0);
      expect(removed.skipped).toEqual(["safe-skill retains local files; managed marker kept"]);
      expect(await readFile(join(directory, "notes.txt"), "utf8")).toBe("keep me\n");
      await expect(readFile(join(directory, "SKILL.md"), "utf8")).rejects.toMatchObject({
        code: "ENOENT",
      });
      expect(await readFile(join(directory, SKILL_MARKER_FILENAME), "utf8")).toContain("skl_test");
      const restored = await materializeSkills({
        root,
        origin: "https://executor.example",
        skills: [skill],
        force: true,
      });
      expect(restored.updated).toBe(1);
      expect(await readFile(join(directory, "SKILL.md"), "utf8")).toBe("managed contents\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("keeps modified generated files managed until a later forced pull", async () => {
    const root = await mkdtemp(join(tmpdir(), "executor-skills-"));
    try {
      await materializeSkills({ root, origin: "server", skills: [skill], force: false });
      const directory = join(root, skill.name);
      await writeFile(join(directory, "SKILL.md"), "local edit\n");
      const stale = await materializeSkills({ root, origin: "server", skills: [], force: false });
      expect(stale.removed).toBe(0);
      expect(await readFile(join(directory, SKILL_MARKER_FILENAME), "utf8")).toContain("skl_test");
      const restored = await materializeSkills({
        root,
        origin: "server",
        skills: [skill],
        force: true,
      });
      expect(restored.updated).toBe(1);
      expect(await readFile(join(directory, "SKILL.md"), "utf8")).toBe("managed contents\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not follow a symlinked parent during stale cleanup", async () => {
    const root = await mkdtemp(join(tmpdir(), "executor-skills-"));
    const outside = await mkdtemp(join(tmpdir(), "executor-skills-outside-"));
    try {
      const nested = { ...skill, files: [{ ...skill.files[0]!, path: "nested/SKILL.md" }] };
      await materializeSkills({ root, origin: "server", skills: [nested], force: false });
      const directory = join(root, skill.name);
      await rm(join(directory, "nested"), { recursive: true });
      await mkdir(join(outside, "nested"));
      await writeFile(join(outside, "nested", "SKILL.md"), bytes);
      await symlink(join(outside, "nested"), join(directory, "nested"));
      await expect(
        materializeSkills({ root, origin: "server", skills: [], force: false }),
      ).rejects.toThrow("Refusing symlink inside managed skill");
      expect(await readFile(join(outside, "nested", "SKILL.md"), "utf8")).toBe(
        "managed contents\n",
      );
      expect(await readFile(join(directory, SKILL_MARKER_FILENAME), "utf8")).toContain("skl_test");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("recovers a managed backup left by an interrupted update", async () => {
    const root = await mkdtemp(join(tmpdir(), "executor-skills-"));
    try {
      await materializeSkills({ root, origin: "server", skills: [skill], force: false });
      const directory = join(root, skill.name);
      await writeFile(join(directory, "SKILL.md"), "local edit\n");
      await rename(
        directory,
        join(root, ".safe-skill.executor-00000000-0000-4000-8000-000000000000.bak"),
      );
      const result = await materializeSkills({
        root,
        origin: "server",
        skills: [skill],
        force: false,
      });
      expect(result.skipped).toEqual(["safe-skill has local changes: SKILL.md"]);
      expect(await readFile(join(directory, "SKILL.md"), "utf8")).toBe("local edit\n");
      const forced = await materializeSkills({
        root,
        origin: "server",
        skills: [skill],
        force: true,
      });
      expect(forced.updated).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("never reclaims an independent skill folder, even with force", async () => {
    const root = await mkdtemp(join(tmpdir(), "executor-skills-"));
    try {
      const directory = join(root, skill.name);
      await mkdir(directory);
      await writeFile(join(directory, "SKILL.md"), "independent\n");
      const result = await materializeSkills({
        root,
        origin: "server",
        skills: [skill],
        force: true,
      });
      expect(result.skipped).toEqual(["safe-skill is not managed by Executor"]);
      expect(await readFile(join(directory, "SKILL.md"), "utf8")).toBe("independent\n");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
