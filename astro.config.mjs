// @ts-check
import { defineConfig, envField } from "astro/config";

import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import cloudflare from "@astrojs/cloudflare";

const SERVER_OPTIMIZE_DEPS = ["react", "react-dom", "react-dom/server.edge", "react-dom/client", "react/jsx-runtime"];

/** Pre-bundle React in workerd SSR to avoid duplicate React instances (Astro 6 + Cloudflare). */
function optimizeServerDeps() {
  return {
    name: "optimize-server-deps",
    configEnvironment(name) {
      if (name !== "client") {
        return {
          optimizeDeps: {
            include: SERVER_OPTIMIZE_DEPS,
          },
        };
      }

      return {
        optimizeDeps: {
          include: ["react", "react-dom", "react-dom/client", "react/jsx-runtime"],
        },
      };
    },
  };
}

// https://astro.build/config
export default defineConfig({
  output: "server",
  integrations: [react(), sitemap()],
  vite: {
    plugins: [tailwindcss(), optimizeServerDeps()],
    resolve: {
      dedupe: ["react", "react-dom"],
      alias: {
        "react-dom/server": "react-dom/server.edge",
      },
    },
  },
  adapter: cloudflare(),
  env: {
    schema: {
      SUPABASE_URL: envField.string({ context: "server", access: "secret", optional: true }),
      SUPABASE_KEY: envField.string({ context: "server", access: "secret", optional: true }),
      TUYA_CLIENT_ID: envField.string({ context: "server", access: "secret", optional: true }),
      TUYA_CLIENT_SECRET: envField.string({ context: "server", access: "secret", optional: true }),
      TUYA_API_BASE_URL: envField.string({ context: "server", access: "secret", optional: true }),
      TUYA_API_REGION: envField.string({ context: "server", access: "secret", optional: true }),
      TUYA_AUTH_MODE: envField.enum({ context: "server", access: "secret", optional: true, values: ["cloud", "app"] }),
      TUYA_APP_IDENTIFIER: envField.string({ context: "server", access: "secret", optional: true }),
      TUYA_CLOUD_CLIENT_ID: envField.string({ context: "server", access: "secret", optional: true }),
      TUYA_CLOUD_CLIENT_SECRET: envField.string({ context: "server", access: "secret", optional: true }),
    },
  },
});
