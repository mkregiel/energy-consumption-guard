import { test, expect, type Page } from "@playwright/test";
import { deleteTuyaOAuthTokenForTestUser } from "./lib/tuya-cleanup";

// Risk: R-E1 (context/foundation/test-plan.md) — the OAuth start -> callback ->
// dashboard-rehydration chain (frame.md stages 2-4), exercised against the
// Phase 1 Tuya stub (e2e/tuya-stub-server.ts) without ever navigating to
// Tuya's hosted consent UI. Modeled on e2e/seed.spec.ts.

// Starts the OAuth flow and extracts the `state` query param from the stub
// redirect's Location header — this is the real tuya_oauth_state value the
// tuya_oauth_state cookie now holds, required for the callback to accept the code.
async function startOAuthAndGetState(page: Page): Promise<string> {
  const response = await page.request.get("https://127.0.0.1:3000/api/tuya/oauth/start", { maxRedirects: 0 });
  const location = response.headers().location;
  if (!location) throw new Error("Expected /api/tuya/oauth/start to respond with a Location header");

  const state = new URL(location).searchParams.get("state");
  if (!state) throw new Error(`Expected a state query param in Location header: ${location}`);

  return state;
}

// Serial: both tests authenticate as the same e2e user and mutate the same
// tuya_oauth_tokens row, so running them in parallel workers races on that row.
test.describe.configure({ mode: "serial" });

test.describe("Tuya OAuth connect", () => {
  test.afterAll(async () => {
    await deleteTuyaOAuthTokenForTestUser();
  });

  test("Tuya OAuth connect stores token and shows linked device", async ({ page }) => {
    await page.goto("https://127.0.0.1:3000/dashboard");
    const state = await startOAuthAndGetState(page);

    const callbackResponse = page.waitForResponse("**/api/tuya/oauth/callback");
    await page.goto(`https://127.0.0.1:3000/dashboard/tuya/callback?code=e2e-tuya-token&state=${state}`);

    const callbackBody = (await (await callbackResponse).json()) as { ok: boolean; data: { linked: boolean } };
    expect(callbackBody.ok).toBe(true);
    expect(callbackBody.data.linked).toBe(true);

    await expect(page.getByText("Konto Tuya zostało połączone.")).toBeVisible();

    await expect(page.getByRole("link", { name: "Przejdź do pulpitu" })).toBeVisible();
    await page.goto("https://127.0.0.1:3000/dashboard");

    await expect(page.getByText("Konto Tuya jest połączone")).toBeVisible();
    await expect(page.getByText("e2e-tuya-uid")).toBeVisible();

    await page.getByRole("button", { name: "Zmień urządzenie" }).click();
    await expect(page.getByText("E2E Test Meter")).toBeVisible();
  });

  test("Tuya OAuth error response surfaces in callback panel", async ({ page }) => {
    await page.goto("https://127.0.0.1:3000/dashboard");
    const state = await startOAuthAndGetState(page);

    const callbackResponse = page.waitForResponse("**/api/tuya/oauth/callback");
    await page.goto(`https://127.0.0.1:3000/dashboard/tuya/callback?code=e2e-tuya-error&state=${state}`);

    const callbackBody = (await (await callbackResponse).json()) as { ok: boolean; error: { code: string } };
    expect(callbackBody.ok).toBe(false);
    expect(callbackBody.error.code).toBe("TUYA_PROVIDER_ERROR");

    await expect(page.getByText("Nie udało się połączyć konta")).toBeVisible();
    await expect(page.getByRole("link", { name: "Połącz ponownie" })).toBeVisible();
  });
});
