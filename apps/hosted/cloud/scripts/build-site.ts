import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import { Effect, FileSystem, Path, Schema } from "effect";

export class SiteAssetCollision extends Schema.TaggedError<SiteAssetCollision>()(
  "SiteAssetCollision",
  { asset: Schema.String, sources: Schema.Array(Schema.String) },
) {}

type Asset = Readonly<{ source: string; relative: string }>;

const siteBuild = Effect.gen(function* () {
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const root = yield* path.fromFileUrl(new URL("../../../..", import.meta.url));
  const marketing = path.join(root, "apps/marketing/dist");
  const dashboard = path.join(root, "apps/hosted/cloud/web/dist");
  const output = path.join(root, "apps/hosted/cloud/.generated/site");

  const listAssets = (directory: string) =>
    Effect.gen(function* () {
      const entries = yield* fs.readDirectory(directory, { recursive: true });
      const assets: Array<Asset> = [];
      for (const entry of entries) {
        const source = path.join(directory, entry);
        const info = yield* fs.stat(source);
        if (info.type === "File") assets.push({ source, relative: entry });
      }
      return assets;
    });

  const marketingAssets = yield* listAssets(marketing);
  const dashboardAssets = yield* listAssets(dashboard);
  const assets = new Map<string, Array<Asset>>();

  const addAsset = (asset: Asset, relative = asset.relative) => {
    // _redirects is composed below from both builds. The dashboard entry is
    // renamed so the marketing site's index remains the asset root.
    if (relative === "_redirects") return;
    const destination =
      relative === "index.html" && asset.source.startsWith(dashboard) ? "dashboard.html" : relative;
    const existing = assets.get(destination) ?? [];
    existing.push({ ...asset, relative: destination });
    assets.set(destination, existing);
  };
  for (const asset of marketingAssets) addAsset(asset);
  for (const asset of dashboardAssets) addAsset(asset);

  for (const [relative, matches] of assets) {
    if (matches.length > 1) {
      return yield* Effect.fail(
        new SiteAssetCollision({
          asset: relative,
          sources: matches.map((match) => match.source),
        }),
      );
    }
  }

  // workerd holds an open handle to the asset root in dev. Keep that directory
  // alive when rebuilding; replacing it leaves the running disk service on an
  // unlinked directory even after new files are written at the same path.
  yield* fs.makeDirectory(output, { recursive: true });
  for (const entry of yield* fs.readDirectory(output)) {
    yield* fs.remove(path.join(output, entry), { recursive: true, force: true });
  }
  for (const [relative, matches] of assets) {
    const asset = matches[0];
    if (asset === undefined)
      return yield* Effect.die(`Asset map entry "${relative}" has no source.`);
    const destination = path.join(output, relative);
    yield* fs.makeDirectory(path.dirname(destination), { recursive: true });
    yield* fs.copyFile(asset.source, destination);
  }

  const marketingRedirects = new Set<string>(["/home /index.html 200", "/home/ /home 308"]);
  for (const asset of marketingAssets) {
    if (!asset.relative.endsWith(".html")) continue;
    const relative = asset.relative.replaceAll(path.sep, "/");
    if (relative === "index.html") continue;
    const route = relative.endsWith("/index.html")
      ? `/${relative.slice(0, -"/index.html".length)}`
      : `/${relative.slice(0, -".html".length)}`;
    marketingRedirects.add(`${route} /${relative} 200`);
    marketingRedirects.add(`${route}/ ${route} 308`);
  }

  const dashboardRedirects = yield* fs.readFileString(path.join(dashboard, "_redirects"));
  const redirects = new Set([
    ...marketingRedirects,
    ...dashboardRedirects
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  ]);
  yield* fs.writeFileString(
    path.join(output, "_redirects"),
    [...redirects].sort().join("\n") + "\n",
  );
}).pipe(Effect.provide(NodeServices.layer));

NodeRuntime.runMain(siteBuild);
