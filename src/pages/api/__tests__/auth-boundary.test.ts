import { describe, it, expect } from "vitest";
import type { APIContext } from "astro";
import { GET as limitsGET, POST as limitsPOST } from "@/pages/api/limits/index";
import { GET as notificationsGET, POST as notificationsPOST } from "@/pages/api/notifications/index";

const unauthCtx = { locals: { user: null } } as unknown as APIContext;

describe("unauthenticated requests are rejected", () => {
  it("GET /api/limits returns 401", async () => {
    const response = await limitsGET(unauthCtx);
    expect(response.status).toBe(401);
  });

  it("POST /api/limits returns 401", async () => {
    const response = await limitsPOST(unauthCtx);
    expect(response.status).toBe(401);
  });

  it("GET /api/notifications returns 401", async () => {
    const response = await notificationsGET(unauthCtx);
    expect(response.status).toBe(401);
  });

  it("POST /api/notifications returns 401", async () => {
    const response = await notificationsPOST(unauthCtx);
    expect(response.status).toBe(401);
  });
});
