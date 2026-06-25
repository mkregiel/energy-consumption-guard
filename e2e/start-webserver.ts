import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { startTuyaStub } from "./tuya-stub-server";

const DEV_VARS_PATH = resolve(process.cwd(), ".dev.vars");

/**
 * The Cloudflare adapter's dev runtime (Wrangler/Miniflare) sources
 * `astro:env/server` secrets from `.dev.vars`, ignoring `process.env` —
 * so overriding TUYA_API_BASE_URL via the spawned child's env (below) is
 * not enough on its own. Temporarily rewrite .dev.vars's TUYA_API_BASE_URL
 * to point at the stub; restoreDevVars() puts the original content back.
 */
function overrideDevVarsTuyaBaseUrl(stubUrl: string): string | null {
  if (!existsSync(DEV_VARS_PATH)) {
    return null;
  }

  const original = readFileSync(DEV_VARS_PATH, "utf-8");
  const overridden = /^TUYA_API_BASE_URL=.*$/m.test(original)
    ? original.replace(/^TUYA_API_BASE_URL=.*$/m, `TUYA_API_BASE_URL=${stubUrl}`)
    : `${original}\nTUYA_API_BASE_URL=${stubUrl}\n`;

  writeFileSync(DEV_VARS_PATH, overridden);
  return original;
}

function restoreDevVars(original: string | null): void {
  if (original !== null) {
    writeFileSync(DEV_VARS_PATH, original);
  }
}

/**
 * Single command Playwright's `webServer` runs: starts the local Tuya stub,
 * then the HTTPS dev server with TUYA_API_BASE_URL pointed at the stub.
 *
 * Deliberately does NOT load .env.test: Vite's env loading doesn't override
 * existing process.env values, so injecting .env.test's SUPABASE_URL (the
 * cloud project, used by vitest/cleanup scripts for admin operations) here
 * would pair it with .env's local SUPABASE_KEY and break auth ("Invalid API
 * key"). The dev server gets its Supabase config from .env as normal.
 */
async function main(): Promise<void> {
  const stub = await startTuyaStub();
  // eslint-disable-next-line no-console
  console.log(`[e2e] Tuya stub listening at ${stub.url}`);

  const originalDevVars = overrideDevVarsTuyaBaseUrl(stub.url);

  const isCI = !!process.env.CI;
  const devCommand = isCI ? "dev" : "dev:https";

  const child = spawn("npm", ["run", devCommand], {
    stdio: "inherit",
    shell: true,
    env: {
      ...process.env,
      TUYA_API_BASE_URL: stub.url,
    },
  });

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    child.kill();
    restoreDevVars(originalDevVars);
    await stub.close();
  };

  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());

  child.on("exit", (code) => {
    void shutdown().then(() => process.exit(code ?? 0));
  });
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error("[e2e] start-webserver failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
