import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineWorkersProject } from "@cloudflare/vitest-pool-workers/config";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

/**
 * Loads .env.test as a plain object so its values can be passed into the worker
 * as Miniflare bindings — `process.env` injection (vitest.setup.ts) doesn't reach
 * isolated workerd instances the way it reaches Node worker threads.
 */
function loadEnvTestBindings(): Record<string, string> {
  const envPath = path.resolve(__dirname, ".env.test");
  let raw: string;
  try {
    raw = readFileSync(envPath, "utf-8");
  } catch {
    return {};
  }

  const bindings: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (key) bindings[key] = value;
  }
  return bindings;
}

export default defineWorkersProject({
  plugins: [
    {
      name: "astro-env-server-shim-workers",
      resolveId(id: string) {
        if (id === "astro:env/server") return "\0astro:env/server";
      },
      load(id: string) {
        if (id === "\0astro:env/server") {
          // Sourced from `cloudflare:test`'s `env`, which exposes the bindings
          // configured below — workerd doesn't share Node's `process.env`.
          return [
            'import { env } from "cloudflare:test";',
            "export const SUPABASE_URL = env.SUPABASE_URL;",
            "export const SUPABASE_KEY = env.SUPABASE_KEY;",
            "export const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;",
            "export const CRON_SECRET = env.CRON_SECRET;",
            "export const PUBLIC_SUPABASE_URL = env.PUBLIC_SUPABASE_URL;",
            "export const PUBLIC_SUPABASE_ANON_KEY = env.PUBLIC_SUPABASE_ANON_KEY;",
            "export const RESEND_API_KEY = env.RESEND_API_KEY;",
            "export const RESEND_FROM_EMAIL = env.RESEND_FROM_EMAIL;",
            "export const TUYA_CLIENT_ID = env.TUYA_CLIENT_ID;",
            "export const TUYA_CLIENT_SECRET = env.TUYA_CLIENT_SECRET;",
            "export const TUYA_API_BASE_URL = env.TUYA_API_BASE_URL;",
            "export const TUYA_API_REGION = env.TUYA_API_REGION;",
            "export const TUYA_AUTH_MODE = env.TUYA_AUTH_MODE;",
            "export const TUYA_APP_IDENTIFIER = env.TUYA_APP_IDENTIFIER;",
            "export const TUYA_CLOUD_CLIENT_ID = env.TUYA_CLOUD_CLIENT_ID;",
            "export const TUYA_CLOUD_CLIENT_SECRET = env.TUYA_CLOUD_CLIENT_SECRET;",
            "export const TUYA_OAUTH_REDIRECT_URI = env.TUYA_OAUTH_REDIRECT_URI;",
            "export const TUYA_OAUTH_SCOPE = env.TUYA_OAUTH_SCOPE;",
          ].join("\n");
        }
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    include: ["src/lib/services/__tests__/breach-notifications*.test.ts"],
    // The Supabase admin client in beforeAll/beforeEach runs on the main thread
    // (outside the worker), so it still needs .env.test in process.env — reuse
    // the existing global setup rather than duplicating the load logic.
    // Depends on vitest.setup.ts — removing that file silently breaks the Supabase admin client in beforeAll.
    globalSetup: ["./vitest.setup.ts"],
    poolOptions: {
      workers: {
        // Mirrors wrangler.jsonc — keeps the test runtime in parity with deployment.
        miniflare: {
          compatibilityDate: "2026-05-08",
          compatibilityFlags: ["nodejs_compat"],
          bindings: loadEnvTestBindings(),
        },
      },
    },
  },
});
