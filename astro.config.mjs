// @ts-check
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
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

const devHttps = process.env.ASTRO_DEV_HTTPS === "1";
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const devHttpsAllowedDomains = [
  { hostname: "127.0.0.1", protocol: "https", port: "3000" },
  { hostname: "localhost", protocol: "https", port: "3000" },
];

/** @returns {{ cert: Buffer; key: Buffer } | undefined} */
function getDevHttpsConfig() {
  if (!devHttps) {
    return undefined;
  }

  const certPath = path.join(projectRoot, "certs", "127.0.0.1+2.pem");
  const keyPath = path.join(projectRoot, "certs", "127.0.0.1+2-key.pem");

  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    throw new Error(
      `HTTPS dev requires cert files at certs/127.0.0.1+2.pem and certs/127.0.0.1+2-key.pem. Run: npm run certs:generate`,
    );
  }

  return {
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
  };
}

// https://astro.build/config
export default defineConfig({
  output: "server",
  integrations: [react(), sitemap()],
  ...(devHttps
    ? {
        security: {
          allowedDomains: devHttpsAllowedDomains,
          // Vite HTTPS dev still constructs request URLs as http:// internally; browser Origin is https://.
          checkOrigin: false,
        },
      }
    : {}),
  ...(devHttps
    ? {
        server: {
          host: "127.0.0.1",
          port: 3000,
        },
      }
    : {}),
  vite: {
    plugins: [tailwindcss(), optimizeServerDeps()],
    resolve: {
      dedupe: ["react", "react-dom"],
      alias: {
        "react-dom/server": "react-dom/server.edge",
      },
    },
    ...(devHttps
      ? {
          server: {
            host: "127.0.0.1",
            port: 3000,
            https: getDevHttpsConfig(),
          },
        }
      : {}),
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
      TUYA_OAUTH_REDIRECT_URI: envField.string({ context: "server", access: "secret", optional: true }),
      TUYA_OAUTH_SCOPE: envField.string({ context: "server", access: "secret", optional: true }),
    },
  },
});
