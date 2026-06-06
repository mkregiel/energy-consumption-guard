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
      },
      load(id: string) {
        if (id === "\0astro:env/server") {
          return [
            "export const SUPABASE_URL = process.env.SUPABASE_URL;",
            "export const SUPABASE_KEY = process.env.SUPABASE_KEY;",
            "export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;",
            "export const CRON_SECRET = process.env.CRON_SECRET;",
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
  },
});
