import { test, expect } from "@playwright/test";

test.describe("Dashboard", () => {
  test("Run sychronization ends with success", async ({ page }) => {
    await page.goto("https://127.0.0.1:3000/dashboard");
    await page.waitForLoadState("networkidle");

    expect(await page.title()).toContain("Pulpit");

    let responseStatus: number | undefined;
    let responseBody: { ok: boolean; data: { status: string; synced: boolean } } | undefined;
    await page.route("**/api/tuya/sync", async (route) => {
      const response = await route.fetch();
      responseStatus = response.status();
      responseBody = await response.json();
      await route.fulfill({ response });
    });

    await page.getByRole("button", { name: "Synchronizuj teraz" }).click();
    await expect.poll(() => responseBody).toBeTruthy();

    expect(responseStatus).toBe(200);
    expect(responseBody?.ok).toBe(true);
    expect(responseBody?.data.status).toBe("synced");
    expect(responseBody?.data.synced).toBe(true);
  });

  test("Notification email update persists after page reload", async ({ page }) => {
    const notificationEmail = `kregielm+e2e-test-${Date.now()}@gmail.com`;
    await page.goto("https://127.0.0.1:3000/dashboard");
    await page.waitForLoadState("networkidle");

    expect(await page.title()).toContain("Pulpit");

    let emailInput = page.getByRole("textbox", { name: "Adres e-mail" });
    await emailInput.fill(notificationEmail);
    await expect(emailInput).toHaveValue(notificationEmail);

    const [response] = await Promise.all([
      page.waitForResponse("**/api/notifications"),
      page.getByRole("button", { name: "Zapisz adres e-mail" }).click(),
    ]);

    await page.reload();
    await page.waitForLoadState("networkidle");

    emailInput = page.getByRole("textbox", { name: "Adres e-mail" });
    await expect(emailInput).toHaveValue(notificationEmail);
  });
});
