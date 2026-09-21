# Releasing

This repo uses Changesets for version orchestration. Publishing is not wired
up yet:

- No package in this repo is publishable today. Every workspace package is
  `"private": true`, so `.changeset/config.json`'s `fixed` group is
  intentionally empty.
- The `executor` CLI package does not exist yet in this repo (tracked by
  #229 — porting the old repo's platform-package layout).
- No CI workflow calls `bun run release:version` or `scripts/release/release.ts`
  yet (tracked by #231 — wiring publish workflows).

This PR only adds the driver: config, scripts, and prerelease mode, so that
adding a changeset is possible today and publishing can be turned on later
without redesigning the versioning setup.

## What is wired now

- `bun run changeset` — add a changeset for a change to a tracked package.
- `bun run changeset:version` — apply pending changesets: bump versions,
  update `CHANGELOG.md` files, refresh the lockfile, and format.
- `bun run release:version` — the same command, kept as the name a release
  workflow will call.
- `bun run release:beta:start` / `bun run release:beta:stop` — enter or exit
  Changesets prerelease mode.
- `bun run lint:changelog-stubs` — verify every workspace package has a
  `CHANGELOG.md` seed (`scripts/check-changelog-stubs.ts`), so a future
  release-PR-generating workflow never hits a missing file.
- `scripts/release/release.ts` — adapted from the old repo's
  `apps/cli/src/release.ts`. It resolves the release channel (`latest` vs
  `beta`) from the CLI package version and builds/tags/publishes a GitHub
  release for it. It targets `apps/cli`, which does not exist yet; nothing
  currently invokes this script.

## Beta releases

This repo is in Changesets prerelease mode with tag `beta`
(`.changeset/pre.json` is committed). While in this mode, `changeset version`
produces versions like `0.1.0-beta.0`, `0.1.0-beta.1`, and so on, instead of
stable versions. This is deliberate: beta versions must never publish under
the `latest` npm dist-tag.

Exit prerelease mode only at the deliberate cutover to stable releases:

- `bun run release:beta:stop`

Re-enter it with:

- `bun run release:beta:start`

## What still needs to land

- **#229** adds the `executor` CLI package (with `apps/cli/package.json`)
  and the platform packages it depends on. Once that package exists and is
  ready to publish, add it — and any `@executor-js/*` packages meant to ship
  alongside it — to the `fixed` group in `.changeset/config.json`.
- **#231** wires a release workflow: opening/updating a Version Packages PR
  on merges to `main`, and calling `scripts/release/release.ts` (or its
  eventual home) to publish. Until then, `changeset version` and
  `scripts/release/release.ts` are local-only tools.

## Two repositories

Development, pull requests and CI live in this private repository. The public
`UsefulSoftwareCo/executor` repository receives snapshots of `main` on its
`v2` branch. `.github/workflows/export-public.yml` runs
`scripts/export-public.sh` on every push to `main`; the paths in
`scripts/export-public.exclude` never leave this repository. Each export is
one commit whose message is only `Export <sha>`, so pull request titles,
descriptions and commit messages stay private. Each export commit
carries the author of the private commit it exports, so the public branch
credits whoever did the work.

The workflow needs the `PUBLIC_EXPORT_TOKEN` repository secret: a fine-grained
token with `contents: write` on the public repository and nothing else. Deploy
keys are disabled for the organization. The CI Alchemy stack
(`apps/hosted/cloud/alchemy.github.ts`) places that secret from 1Password and
protects the public export branch against deletion and force pushes; see
`notes/ci.md`.

Rules that follow from this model:

- Changelogs are generated from changeset summaries only
  (`@changesets/cli/changelog`). The GitHub changelog generator would write
  pull request numbers, titles and author handles into `CHANGELOG.md`, which
  is exported. Review changeset summaries as public text.
- Publishing runs in this repository's CI. npm packages and GHCR images carry
  the public repository in their metadata. GitHub Releases, which the CLI and
  desktop updaters download from, are created on the public repository.
- A release exports first, then tags the export commit on the public
  repository, then builds and publishes. The tag must point at a public
  commit so a release links to its source.
- The public repository already holds v1 tags and releases. v2 tags use the
  `executor@<version>` form so the v1 updater never matches them.
- Issues are filed on the public repository and fixed here. A fix cannot close
  an issue automatically; close it by hand or reference it in the changeset
  summary as `UsefulSoftwareCo/executor#123`.
- Never open pull requests or push branches to the public repository.
- Production deploys from this repository too: `.github/workflows/deploy.yml`
  deploys the `v2` stage on every push to `main`. See `notes/ci.md`.

## Notes

- `.changeset/config.json`'s `ignore` list excludes playground and e2e-viewer
  packages, which never ship, from version tracking entirely.
