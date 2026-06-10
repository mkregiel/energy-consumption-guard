import { spawn } from "node:child_process";
import { startTuyaStub } from "./tuya-stub-server";

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

  const child = spawn("npm", ["run", "dev:https"], {
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
