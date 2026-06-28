import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, it, expect, vi } from "vitest";
import { updateMeterStatus } from "@/lib/services/meter-service";
import { TuyaServiceError } from "@/lib/services/tuya-errors";

const mockMeter = {
  id: "meter-1",
  user_id: "user-1",
  label: "test-meter",
  tuya_device_id: "dev-1",
  tuya_product_id: null,
  status: "inactive" as const,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

const createMockSupabase = (overrides: { data?: unknown; error?: unknown } = {}) => {
  const single = vi.fn().mockResolvedValue({
    data: overrides.data ?? mockMeter,
    error: overrides.error ?? null,
  });
  const select = vi.fn().mockReturnValue({ single });
  const eq = vi.fn().mockReturnValue({ select });
  const update = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ update });

  return { from, update, eq, select, single } as const;
};

describe("updateMeterStatus", () => {
  it("updates meter status and returns the updated meter", async () => {
    const mock = createMockSupabase({ data: { ...mockMeter, status: "inactive" } });

    const result = await updateMeterStatus(mock as unknown as SupabaseClient, "user-1", "inactive");

    expect(mock.from).toHaveBeenCalledWith("meters");
    expect(mock.update).toHaveBeenCalledWith({ status: "inactive" });
    expect(mock.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(result.status).toBe("inactive");
  });

  it("throws TUYA_METER_NOT_FOUND when no meter exists for user", async () => {
    const mock = createMockSupabase({ data: null, error: { code: "PGRST116", message: "No rows found" } });

    await expect(updateMeterStatus(mock as never, "no-meter-user", "inactive")).rejects.toThrow(TuyaServiceError);
    await expect(updateMeterStatus(mock as never, "no-meter-user", "inactive")).rejects.toMatchObject({
      code: "TUYA_METER_NOT_FOUND",
      httpStatus: 404,
    });
  });

  it("throws on database error", async () => {
    const mock = createMockSupabase({ error: { message: "DB failure" } });

    await expect(updateMeterStatus(mock as never, "user-1", "active")).rejects.toThrow(TuyaServiceError);
  });
});
