import { loadTestEnv } from "./e2e/load-test-env";

// Load .env.test into process.env before any tests run.
// This runs in the global setup context (before workers spin up).
export function setup() {
  loadTestEnv();
}
