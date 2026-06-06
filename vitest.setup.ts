import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load .env.test into process.env before any tests run.
// This runs in the global setup context (before workers spin up).
export function setup() {
  const envPath = resolve(process.cwd(), ".env.test");
  let raw: string;
  try {
    raw = readFileSync(envPath, "utf-8");
  } catch {
    // No .env.test present — integration tests will fail on their own with a clear error.
    return;
  }

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}
