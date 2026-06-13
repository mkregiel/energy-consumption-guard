// Risk: R-E2 — unauthenticated /dashboard visit must redirect to login,
// and post-login must land back on /dashboard.
// Seed: e2e/seed.spec.ts

import { test, expect } from "@playwright/test";
import { loadTestEnv } from "./load-test-env";

loadTestEnv();

const E2E_TEST_USER_EMAIL = process.env.E2E_TEST_USER_EMAIL;
const E2E_TEST_USER_PASSWORD = process.env.E2E_TEST_USER_PASSWORD;
if (!E2E_TEST_USER_EMAIL || !E2E_TEST_USER_PASSWORD) {
  throw new Error("E2E_TEST_USER_EMAIL and E2E_TEST_USER_PASSWORD must be set in .env.test");
}

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Auth redirect (R-E2)", () => {
  test("unauthenticated /dashboard visit redirects to signin and returns after login", async ({ page }) => {
    await page.goto("https://127.0.0.1:3000/dashboard");

    await page.waitForURL(/\/auth\/signin\?returnTo=%2Fdashboard/);

    // The form hydrates client-side (client:load); wait for hydration to finish
    // before typing, otherwise React remounts with empty state and wipes input
    // typed into the still-server-rendered markup.
    await page.waitForLoadState("networkidle");

    await page.getByRole("textbox", { name: "Email" }).fill(E2E_TEST_USER_EMAIL);
    await page.getByRole("textbox", { name: "Password" }).fill(E2E_TEST_USER_PASSWORD);

    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL("https://127.0.0.1:3000/dashboard");

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});
