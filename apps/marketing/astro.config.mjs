// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import react from "@astrojs/react";
import { sentryVitePlugin } from "@sentry/vite-plugin";

// The marketing pages are built as static files. The parent application owns
// auth and product routing at /login and /app respectively.
export default defineConfig({
  site: "https://executor.sh",
  output: "static",
  integrations: [react()],
  vite: {
    build: { sourcemap: "hidden" },
    plugins: [
      tailwindcss(),
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
});
