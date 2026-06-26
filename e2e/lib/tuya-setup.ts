import type { Page } from "@playwright/test";

export async function ensureTuyaLinked(page: Page): Promise<void> {
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

export async function ensureMeterRegistered(page: Page): Promise<void> {
  const res = await page.request.post("/api/meters", {
    data: {
      label: "E2E Test Meter",
      tuya_device_id: "e2e-device-1",
      tuya_product_id: "e2e-product",
    },
  });
  const body = (await res.json()) as { ok: boolean };
  if (!body.ok) throw new Error("Failed to register meter for e2e test");
}
