import { describe, it, expect } from "vitest";
import { getLimitWindowPreview } from "@/lib/services/limit-consumption-preview";
import type { ConsumptionLimit } from "@/types";

// Recording mock Supabase client. Captures the method name and column name of
// every filter call made on the consumption_readings query builder.
const buildRecordingClient = () => {
  const calls: { method: string; column: string }[] = [];

  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    gte: (col: string) => {
      calls.push({ method: "gte", column: col });
      return builder;
    },
    lt: (col: string) => {
      calls.push({ method: "lt", column: col });
      return builder;
    },
    gt: (col: string) => {
      calls.push({ method: "gt", column: col });
      return builder;
    },
    lte: (col: string) => {
      calls.push({ method: "lte", column: col });
      return builder;
    },
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
  };

  const client = { from: () => builder } as unknown as Parameters<typeof getLimitWindowPreview>[0];
  return { client, calls };
};

const testLimit: ConsumptionLimit = {
  id: "limit-1",
  user_id: "user-1",
  threshold_kwh: 100,
  window_type: "month",
  timezone: "Europe/Warsaw",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe("getLimitWindowPreview — recorded_at predicate operators", () => {
  it("issues .gte() and .lt() on recorded_at (not .gt() or .lte())", async () => {
    const { client, calls } = buildRecordingClient();
    await getLimitWindowPreview(client, "meter-1", testLimit);

    const recordedAtCalls = calls.filter((c) => c.column === "recorded_at");
    const methods = recordedAtCalls.map((c) => c.method);

    expect(methods).toContain("gte");
    expect(methods).toContain("lt");
    expect(methods).not.toContain("gt");
    expect(methods).not.toContain("lte");
  });
});
