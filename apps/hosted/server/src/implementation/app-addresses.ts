/** Address construction and parsing share one configured suffix; forwarding headers never select an app. */
import { AppSlug, HttpUrl, type App } from "@executor-js/sdk/core";
import { UiFailed } from "apps/ui/contracts";
import { Effect, Option, Schema } from "effect";
import { AppUiAddressInvalid, AppUiHostnameLabel, type AppUiBaseUrl } from "../contracts/app-ui.ts";
import { OrganizationSlug } from "../contracts/organization.ts";

/** Hosted app--organization addresses resolve current names before authorizing immutable app and organization IDs. */
export const appAddresses = (dashboardOrigin: string, baseUrl: AppUiBaseUrl | undefined) => {
  const base = baseUrl === undefined ? undefined : new URL(baseUrl);
  const dashboardHost = new URL(dashboardOrigin).host;
  const origin = (app: Pick<App, "slug">, slug: OrganizationSlug) =>
    Effect.gen(function* () {
      if (base === undefined) return yield* new UiFailed({ reason: "unavailable" });
      const value = `${app.slug}--${slug}`;
      const label = yield* Schema.decodeUnknownEffect(AppUiHostnameLabel)(value).pipe(
        Effect.mapError(
          () =>
            new AppUiAddressInvalid({ reason: value.length > 63 ? "too_long" : "invalid_slug" }),
        ),
      );
      const url = new URL(base);
      const hostname = `${label}.${base.hostname}`;
      url.hostname = hostname;
      if (url.hostname !== hostname)
        return yield* new AppUiAddressInvalid({ reason: "invalid_slug" });
      if (url.hostname.length > 253) return yield* new UiFailed({ reason: "unavailable" });
      return HttpUrl.make(url.origin);
    });
  const fromHost = (host: string | undefined) => {
    if (base === undefined || host === undefined) return Option.none();
    const url = URL.parse(`${base.protocol}//${host}`);
    const suffix = `.${base.hostname}`;
    if (
      url === null ||
      url.host !== host.toLowerCase() ||
      url.port !== base.port ||
      !url.hostname.endsWith(suffix)
    )
      return Option.none();
    const label = Schema.decodeUnknownOption(AppUiHostnameLabel)(
      url.hostname.slice(0, -suffix.length),
    );
    return Option.flatMap(label, (label) => {
      const [app, slug] = label.split("--");
      return Schema.decodeUnknownOption(
        Schema.Struct({
          find: Schema.Struct({ slug: AppSlug }),
          slug: OrganizationSlug,
          origin: HttpUrl,
        }),
      )({ find: { slug: app }, slug, origin: url.origin });
    });
  };
  return {
    dashboardOrigin,
    enabled: base !== undefined,
    origin,
    fromHost,
    ownsHost: (host: string | undefined) =>
      base !== undefined &&
      host !== undefined &&
      host.toLowerCase() !== dashboardHost &&
      (URL.parse(`${base.protocol}//${host}`)?.hostname.endsWith(`.${base.hostname}`) ?? false),
  };
};
