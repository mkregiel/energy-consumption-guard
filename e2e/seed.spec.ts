import { test, expect } from "@playwright/test";
import { ensureTuyaLinked, ensureMeterRegistered } from "./lib/tuya-setup";

test.describe("Dashboard", () => {
  test("Run sychronization ends with success", async ({ page }) => {
    await ensureTuyaLinked(page);
    await ensureMeterRegistered(page);

    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");

    expect(await page.title()).toContain("Pulpit");

    let responseStatus: number | undefined;
    let responseBody: { ok: boolean; data: { status: string; synced: boolean } } | undefined;
    await page.route("**/api/tuya/sync", async (route) => {
      const response = await route.fetch();
      responseStatus = response.status();
      responseBody = (await response.json()) as { ok: boolean; data: { status: string; synced: boolean } };
      await route.fulfill({ response });
    });

    await page.getByRole("button", { name: "Synchronizuj teraz" }).click();
    await expect.poll(() => responseBody).toBeTruthy();

    expect(responseStatus).toBe(200);
    expect(responseBody?.ok).toBe(true);
    expect(responseBody?.data.status).toBe("synced");
    expect(responseBody?.data.synced).toBe(true);
  });
});
