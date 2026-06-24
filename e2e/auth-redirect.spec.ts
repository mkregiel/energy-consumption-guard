// Risk: R-E2 — unauthenticated /dashboard visit must redirect to login,
// and post-login must land back on /dashboard.
// Seed: e2e/seed.spec.ts

import { test, expect } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Auth redirect (R-E2)", () => {
  test("unauthenticated /dashboard visit redirects to signin and returns after login", async ({ page }) => {
    await page.goto("/dashboard");

    await page.waitForURL(/\/auth\/signin\?returnTo=%2Fdashboard/);

    await page.waitForLoadState("networkidle");

    await page.getByRole("textbox", { name: "Email" }).fill("kregielm@gmail.com");
    await page.getByRole("textbox", { name: "Password" }).fill("asdzxc");

    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL("/dashboard");

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });
});
