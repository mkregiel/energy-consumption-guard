import { describe, it, expect } from "vitest";
import type { User } from "@supabase/supabase-js";
import { requireUser } from "@/lib/auth-guard";
import { isPublicApiRoute } from "@/middleware";

describe("requireUser", () => {
  it("returns a 401 Response when user is null", () => {
    const result = requireUser({ user: null });
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(401);
  });

  it("returns the user when user is set", () => {
    const stub = { id: "user-1" } as unknown as User;
    const result = requireUser({ user: stub });
    expect(result).toBe(stub);
  });
});

describe("isPublicApiRoute", () => {
  it.each([
    ["/api/limits", false],
    ["/api/limits/", false],
    ["/api/notifications", false],
    ["/api/notifications/", false],
    ["/api/auth/signin", true],
    ["/api/cron/evaluate-limits", true],
  ])("%s → %s", (path, expected) => {
    expect(isPublicApiRoute(path)).toBe(expected);
  });
});
