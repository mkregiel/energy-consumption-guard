import { test, expect } from "@playwright/test";

async function ensureTuyaLinked(page: import("@playwright/test").Page): Promise<void> {
  const response = await page.request.get("/api/tuya/oauth/start", { maxRedirects: 0 });
  const location = response.headers().location;
  if (!location) throw new Error("Expected /api/tuya/oauth/start to respond with a Location header");

  const state = new URL(location).searchParams.get("state");
  if (!state) throw new Error(`Expected a state query param in Location header: ${location}`);

  const callbackRes = await page.request.post("/api/tuya/oauth/callback", {
    data: { code: "e2e-tuya-token", state },
  });
  const body = (await callbackRes.json()) as { ok: boolean };
  if (!body.ok) throw new Error("Failed to link Tuya account for seed sync test");
}

test.describe("Dashboard", () => {
  test("Run sychronization ends with success", async ({ page }) => {
    await ensureTuyaLinked(page);

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
