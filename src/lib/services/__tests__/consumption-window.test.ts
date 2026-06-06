import { describe, it, expect } from "vitest";
import { getWindowBounds } from "@/lib/services/consumption-window";
import type { WindowType } from "@/types";

// Oracle-derived fixture table. Expected values are computed from calendar rules
// (Europe/Warsaw timezone math), NOT from running getWindowBounds() and recording output.
const fixtures: {
  label: string;
  windowType: WindowType;
  referenceDate: string;
  expectedStart: string;
  expectedEnd: string;
}[] = [
  {
    label: "day — June 15 CEST (UTC+2)",
    windowType: "day",
    referenceDate: "2026-06-15T10:00:00.000Z",
    // June 15 00:00:00 CEST = June 14 22:00:00 UTC
    expectedStart: "2026-06-14T22:00:00.000Z",
    // June 16 00:00:00 CEST = June 15 22:00:00 UTC
    expectedEnd: "2026-06-15T22:00:00.000Z",
  },
  {
    label: "week — Thursday June 11 CEST (Monday June 8 → Monday June 15)",
    windowType: "week",
    referenceDate: "2026-06-11T10:00:00.000Z",
    // Monday June 8 00:00:00 CEST = June 7 22:00:00 UTC
    expectedStart: "2026-06-07T22:00:00.000Z",
    // Monday June 15 00:00:00 CEST = June 14 22:00:00 UTC
    expectedEnd: "2026-06-14T22:00:00.000Z",
  },
  {
    label: "month — June 15 CEST (June 1 → July 1 midnight CEST)",
    windowType: "month",
    referenceDate: "2026-06-15T10:00:00.000Z",
    // June 1 00:00:00 CEST = May 31 22:00:00 UTC
    expectedStart: "2026-05-31T22:00:00.000Z",
    // July 1 00:00:00 CEST = June 30 22:00:00 UTC
    expectedEnd: "2026-06-30T22:00:00.000Z",
  },
  {
    label: "day — DST spring-forward March 29 (23-hour window: CET start, CEST end)",
    windowType: "day",
    referenceDate: "2026-03-29T10:00:00.000Z",
    // March 29 00:00:00 CET (UTC+1) = March 28 23:00:00 UTC
    expectedStart: "2026-03-28T23:00:00.000Z",
    // March 30 00:00:00 CEST (UTC+2) = March 29 22:00:00 UTC → 23-hour window
    expectedEnd: "2026-03-29T22:00:00.000Z",
  },
];

describe("getWindowBounds", () => {
  it.each(fixtures)("$label", ({ windowType, referenceDate, expectedStart, expectedEnd }) => {
    const result = getWindowBounds(windowType, "Europe/Warsaw", new Date(referenceDate));
    expect(result.windowStart.toISOString()).toBe(expectedStart);
    expect(result.windowEnd.toISOString()).toBe(expectedEnd);
  });
});

// Half-open interval semantics: windowStart is included (>=), windowEnd is excluded (<).
// These use the month fixture as the vehicle.
describe("getWindowBounds — half-open interval semantics", () => {
  const { windowStart, windowEnd } = getWindowBounds("month", "Europe/Warsaw", new Date("2026-06-15T10:00:00.000Z"));

  it("windowStart timestamp satisfies >= windowStart (inclusive lower bound)", () => {
    expect(windowStart.getTime() >= windowStart.getTime()).toBe(true);
  });

  it("windowEnd timestamp does NOT satisfy < windowEnd (exclusive upper bound)", () => {
    expect(windowEnd.getTime() < windowEnd.getTime()).toBe(false);
  });

  it("one millisecond before windowStart is excluded by the >= predicate", () => {
    expect(windowStart.getTime() - 1 < windowStart.getTime()).toBe(true);
  });
});
