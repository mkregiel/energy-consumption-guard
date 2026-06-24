// Risk: R-E3 — limit form or alarm-email form saves at the API level but
// the dashboard renders stale values — user sees no confirmation.
// Seed: e2e/seed.spec.ts

import { test, expect } from "@playwright/test";

test.describe("Dashboard form round-trips (R-E3)", () => {
  test("Consumption limit form shows success message after save", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    // Read current threshold so we can set a distinct value
    const thresholdInput = page.getByRole("spinbutton", { name: "Próg zużycia (kWh)" });
    const currentValue = await thresholdInput.inputValue();
    const newThreshold = currentValue ? String(Number(currentValue) + 1) : "42";

    await thresholdInput.fill(newThreshold);

    await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/limits") && res.request().method() === "POST"),
      page.getByRole("button", { name: "Zapisz limit" }).click(),
    ]);

    await expect(page.getByText("Limit zapisany pomyślnie.")).toBeVisible();
  });

  test("Alarm email form shows success message immediately after save", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    const uniqueEmail = `e2e-${Date.now()}@example.com`;

    await page.getByRole("textbox", { name: "Adres e-mail" }).fill(uniqueEmail);

    await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/notifications") && res.request().method() === "POST"),
      page.getByRole("button", { name: "Zapisz adres e-mail" }).click(),
    ]);

    await expect(page.getByText("Adres e-mail zapisany pomyślnie.")).toBeVisible();

    // Verify persistence across reload
    await page.reload();
    await page.waitForLoadState("networkidle");

    await expect(page.getByRole("textbox", { name: "Adres e-mail" })).toHaveValue(uniqueEmail);
  });
});
