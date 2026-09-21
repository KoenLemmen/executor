import { sentryVitePlugin } from "@sentry/vite-plugin";
import { dashboardViteConfig } from "@executor-js/hosted-web/vite";
import { mergeConfig } from "vite-plus";
import { cloudflareRedirects } from "./cloudflare-redirects.ts";

const redirects = cloudflareRedirects();

export default mergeConfig(
  dashboardViteConfig({
    apiUrl: process.env.HOSTED_API_URL ?? "http://127.0.0.1:4411",
    port: 4412,
    routePlugins: [redirects.routes],
  }),
  {
    build: { sourcemap: "hidden" },
    plugins: [
      redirects.assets,
      ...(process.env.SENTRY_AUTH_TOKEN
        ? [
            sentryVitePlugin({
              telemetry: false,
              sourcemaps: { filesToDeleteAfterUpload: ["./dist/**/*.map"] },
            }),
          ]
        : []),
    ],
  },
);
