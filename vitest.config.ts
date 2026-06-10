import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [
    {
      name: "astro-env-server-shim",
      resolveId(id: string) {
        if (id === "astro:env/server") return "\0astro:env/server";
        if (id === "astro:middleware") return "\0astro:middleware";
      },
      load(id: string) {
        if (id === "\0astro:middleware") {
          return "export const defineMiddleware = (fn) => fn;";
        }
        if (id === "\0astro:env/server") {
          return [
            "export const SUPABASE_URL = process.env.SUPABASE_URL;",
            "export const SUPABASE_KEY = process.env.SUPABASE_KEY;",
            "export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;",
            "export const CRON_SECRET = process.env.CRON_SECRET;",
            "export const PUBLIC_SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL;",
            "export const PUBLIC_SUPABASE_ANON_KEY = process.env.PUBLIC_SUPABASE_ANON_KEY;",
            "export const RESEND_API_KEY = process.env.RESEND_API_KEY;",
            "export const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL;",
            "export const TUYA_CLIENT_ID = process.env.TUYA_CLIENT_ID;",
            "export const TUYA_CLIENT_SECRET = process.env.TUYA_CLIENT_SECRET;",
            "export const TUYA_API_BASE_URL = process.env.TUYA_API_BASE_URL;",
            "export const TUYA_API_REGION = process.env.TUYA_API_REGION;",
            "export const TUYA_AUTH_MODE = process.env.TUYA_AUTH_MODE;",
            "export const TUYA_APP_IDENTIFIER = process.env.TUYA_APP_IDENTIFIER;",
            "export const TUYA_CLOUD_CLIENT_ID = process.env.TUYA_CLOUD_CLIENT_ID;",
            "export const TUYA_CLOUD_CLIENT_SECRET = process.env.TUYA_CLOUD_CLIENT_SECRET;",
            "export const TUYA_OAUTH_REDIRECT_URI = process.env.TUYA_OAUTH_REDIRECT_URI;",
            "export const TUYA_OAUTH_SCOPE = process.env.TUYA_OAUTH_SCOPE;",
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
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Runs under @cloudflare/vitest-pool-workers instead — see vitest.workers.config.ts.
    exclude: [
      "**/node_modules/**",
      "src/lib/services/__tests__/breach-notifications*.test.ts",
      "src/lib/services/__tests__/tuya-token-sync*.test.ts",
    ],
    // globalSetup loads .env.test into process.env before workers fork. Using globalSetup
    // (not envFile) so the same vars are visible to the Supabase admin client calls in
    // beforeAll, which run in the main thread. If worker parallelism is added later,
    // migrate to setupFiles or Vitest's envFile option so per-worker isolation is respected.
    globalSetup: ["./vitest.setup.ts"],
  },
});
