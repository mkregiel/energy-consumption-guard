import { describe, it, expect, vi, beforeEach } from "vitest";
import type { APIContext } from "astro";

const mockDeleteUserLimit = vi.fn();

vi.mock("@/lib/supabase", () => ({
  createClient: vi.fn().mockReturnValue({}),
}));

vi.mock("@/lib/services/limit-service", () => ({
  getUserLimit: vi.fn(),
  upsertUserLimit: vi.fn(),
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  deleteUserLimit: (...args: unknown[]) => mockDeleteUserLimit(...args),
}));

const { DELETE } = await import("@/pages/api/limits/index");

const makeCtx = (overrides: { user?: unknown } = {}): APIContext =>
  ({
    request: new Request("http://localhost/api/limits", {
      method: "DELETE",
    }),
    locals: { user: overrides.user ?? { id: "user-1" } },
    cookies: {},
  }) as unknown as APIContext;

describe("DELETE /api/limits", () => {
  beforeEach(() => {
    mockDeleteUserLimit.mockReset();
    mockDeleteUserLimit.mockResolvedValue(undefined);
  });

  it("returns 401 when unauthenticated", async () => {
    const ctx = { locals: { user: null } } as unknown as APIContext;
    const response = await DELETE(ctx);
    expect(response.status).toBe(401);
  });

  it("returns 200 on successful delete", async () => {
    const response = await DELETE(makeCtx());
    expect(response.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const json: { ok: boolean } = await response.json();
    expect(json.ok).toBe(true);
    expect(mockDeleteUserLimit).toHaveBeenCalledWith({}, "user-1");
  });

  it("returns error response when service throws", async () => {
    const { TuyaServiceError } = await import("@/lib/services/tuya-errors");
    mockDeleteUserLimit.mockRejectedValue(new TuyaServiceError("LIMIT_DB_ERROR", "Failed", 500));

    const response = await DELETE(makeCtx());
    expect(response.status).toBe(500);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const json: { ok: boolean } = await response.json();
    expect(json.ok).toBe(false);
  });
});
