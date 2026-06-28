import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIContext } from "astro";

const mockUpdateMeterStatus = vi.fn();

vi.mock("@/lib/supabase", () => ({
  createClient: vi.fn().mockReturnValue({}),
}));

vi.mock("@/lib/services/meter-service", () => ({
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  updateMeterStatus: (...args: unknown[]) => mockUpdateMeterStatus(...args),
}));

const { PATCH } = await import("@/pages/api/meters/status");

const makeCtx = (overrides: { user?: unknown; body?: unknown } = {}): APIContext =>
  ({
    request: new Request("http://localhost/api/meters/status", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(overrides.body ?? { status: "inactive" }),
    }),
    locals: { user: overrides.user ?? { id: "user-1" } },
    cookies: {},
  }) as unknown as APIContext;

describe("PATCH /api/meters/status", () => {
  beforeEach(() => {
    mockUpdateMeterStatus.mockReset();
    mockUpdateMeterStatus.mockResolvedValue({
      id: "meter-1",
      user_id: "user-1",
      label: "test",
      tuya_device_id: "dev-1",
      tuya_product_id: null,
      status: "inactive",
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    });
  });

  it("returns 401 when unauthenticated", async () => {
    const ctx = { locals: { user: null } } as unknown as APIContext;
    const response = await PATCH(ctx);
    expect(response.status).toBe(401);
  });

  it("returns 400 for invalid status value", async () => {
    const response = await PATCH(makeCtx({ body: { status: "unknown" } }));
    expect(response.status).toBe(400);
  });

  it("returns 200 with updated meter on valid request", async () => {
    const response = await PATCH(makeCtx({ body: { status: "inactive" } }));
    expect(response.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const json: { ok: boolean; data: { meter: { status: string } } } = await response.json();
    expect(json.ok).toBe(true);
    expect(json.data.meter.status).toBe("inactive");
  });
});
