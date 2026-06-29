import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, it, expect, vi } from "vitest";
import { deleteUserLimit } from "@/lib/services/limit-service";
import { TuyaServiceError } from "@/lib/services/tuya-errors";

const createMockSupabase = (overrides: { error?: unknown } = {}) => {
  const eq = vi.fn().mockResolvedValue({
    error: overrides.error ?? null,
  });
  const deleteFn = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ delete: deleteFn });

  return { from, delete: deleteFn, eq } as const;
};

describe("deleteUserLimit", () => {
  it("deletes the user's consumption limit", async () => {
    const mock = createMockSupabase();

    await deleteUserLimit(mock as unknown as SupabaseClient, "user-1");

    expect(mock.from).toHaveBeenCalledWith("consumption_limits");
    expect(mock.delete).toHaveBeenCalled();
    expect(mock.eq).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("throws TuyaServiceError on database error", async () => {
    const mock = createMockSupabase({ error: { message: "DB failure" } });

    await expect(deleteUserLimit(mock as unknown as SupabaseClient, "user-1")).rejects.toThrow(TuyaServiceError);
    await expect(deleteUserLimit(mock as unknown as SupabaseClient, "user-1")).rejects.toMatchObject({
      code: "LIMIT_DB_ERROR",
      httpStatus: 500,
    });
  });
});
