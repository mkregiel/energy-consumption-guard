import { describe, it, expect } from "vitest";
import { isAccessTokenExpired, TOKEN_REFRESH_SKEW_MS } from "@/lib/services/tuya-client";

// Oracle-first fixture table. Expected values are derived from TOKEN_REFRESH_SKEW_MS
// and calendar math BEFORE running the function — not from recording its output.
const NOW_MS = Date.now();

const fixtures: {
  label: string;
  expiresAt: string;
  forceRefresh: boolean;
  expected: boolean;
}[] = [
  {
    label: "token expires in 120 s — outside 60-second skew",
    expiresAt: new Date(NOW_MS + 120_000).toISOString(),
    forceRefresh: false,
    expected: false,
  },
  {
    label: "token expires in 59 s — inside skew",
    expiresAt: new Date(NOW_MS + 59_000).toISOString(),
    forceRefresh: false,
    expected: true,
  },
  {
    label: "token expires in exactly 60 s — at skew boundary",
    // expiresAt - TOKEN_REFRESH_SKEW_MS === NOW_MS → expired
    expiresAt: new Date(NOW_MS + TOKEN_REFRESH_SKEW_MS).toISOString(),
    forceRefresh: false,
    expected: true,
  },
  {
    label: "token expired 1 s ago",
    expiresAt: new Date(NOW_MS - 1_000).toISOString(),
    forceRefresh: false,
    expected: true,
  },
  {
    label: "token valid for 10 min but forceRefresh=true",
    expiresAt: new Date(NOW_MS + 600_000).toISOString(),
    forceRefresh: true,
    expected: true,
  },
];

describe("isAccessTokenExpired", () => {
  it.each(fixtures)("$label", ({ expiresAt, forceRefresh, expected }) => {
    expect(isAccessTokenExpired(expiresAt, forceRefresh)).toBe(expected);
  });

  it.todo(
    "should surface an error when refresh_token_expires_at has passed — resolveAccessToken() currently never reads this field",
  );
});
