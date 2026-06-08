import { beforeAll, beforeEach, afterEach, afterAll, describe, it, expect, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "astro:env/server";
import { runBreachNotifications } from "@/lib/services/breach-notifications";
import { sendPlainTextEmail } from "@/lib/services/email-client";

// Hoisted mock — prevents astro:env/server from being evaluated at module load time.
vi.mock("@/lib/services/email-client", () => ({
  isResendConfigured: vi.fn().mockReturnValue(true),
  sendPlainTextEmail: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns ISO string for the first day of the current month at midnight Europe/Warsaw. */
function currentMonthStartWarsaw(): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(now)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  );
  const year = Number(parts.year);
  const month = Number(parts.month);

  // Resolve midnight of month-start in Europe/Warsaw to UTC via two-pass offset estimation.
  const utcGuess = Date.UTC(year, month - 1, 1, 0, 0, 0);
  const guessDate = new Date(utcGuess);
  const offsetFormatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Warsaw",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const offsetParts = Object.fromEntries(
    offsetFormatter
      .formatToParts(guessDate)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  );
  const utcHour = guessDate.getUTCHours();
  const localHour = Number(offsetParts.hour);
  const offsetHours = localHour - utcHour;
  const windowStart = new Date(utcGuess - offsetHours * 3_600_000);
  return windowStart.toISOString();
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

// Untyped client (no Database generic) — `.from(table).insert(...)` would otherwise
// resolve the row type to `never` and reject our literal fixture payloads below. The
// codebase has no generated `Database` type to plug in (see supabase-service-role.ts),
// so the `any` type arguments are the only way to bypass that generic chain for this
// fixture-only test client — narrowly disabled here rather than widening prod typings.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let supabase: ReturnType<typeof createClient<any, any, any>>;
let userId: string;
let limitId: string;
let breachId: string;

beforeAll(async () => {
  // Sourced via the astro:env/server shim (not process.env directly) — under the
  // Workers pool, workerd doesn't share process.env across the main thread and
  // the isolated worker, but the shim resolves correctly in both runtimes.
  supabase = createClient(SUPABASE_URL ?? "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Guard: clean up a leftover user from a previously aborted run (e.g. CI timeout).
  const { data: existingUsers } = await supabase.auth.admin.listUsers();
  const existing = existingUsers.users.find((u) => u.email === "test-idempotency@example.com");
  if (existing) await supabase.auth.admin.deleteUser(existing.id);

  const { data, error } = await supabase.auth.admin.createUser({
    email: "test-idempotency@example.com",
    password: crypto.randomUUID(),
    email_confirm: true,
  });
  if (error) throw new Error(`Failed to create test user: ${error.message}`);
  userId = data.user.id;
});

afterAll(async () => {
  await supabase.auth.admin.deleteUser(userId);
});

beforeEach(async () => {
  // Insert consumption_limits
  const { data: limitData, error: limitError } = await supabase
    .from("consumption_limits")
    .insert({ user_id: userId, threshold_kwh: 100, window_type: "month", timezone: "Europe/Warsaw" })
    .select("id")
    .single();
  if (limitError) throw new Error(`Failed to insert limit: ${limitError.message}`);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped fixture client, see line 61
  limitId = limitData.id;

  // Insert limit_breach_events
  const { data: breachData, error: breachError } = await supabase
    .from("limit_breach_events")
    .insert({
      limit_id: limitId,
      user_id: userId,
      breached_at: new Date().toISOString(),
      consumption_kwh: 150,
      notified_at: null,
      notification_failed_at: null,
      notification_attempt_count: 0,
      window_start: currentMonthStartWarsaw(),
    })
    .select("id")
    .single();
  if (breachError) throw new Error(`Failed to insert breach: ${breachError.message}`);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped fixture client, see line 61
  breachId = breachData.id;

  // Insert notification_settings
  const { error: settingsError } = await supabase
    .from("notification_settings")
    .insert({ user_id: userId, alarm_email: "alarm@example.com" });
  if (settingsError) throw new Error(`Failed to insert notification_settings: ${settingsError.message}`);

  // Reset mock implementation and call history before each test so per-test overrides don't bleed.
  vi.mocked(sendPlainTextEmail).mockReset().mockResolvedValue(undefined);
});

afterEach(async () => {
  // Explicit teardown so beforeEach can re-insert cleanly
  await supabase.from("notification_settings").delete().eq("user_id", userId);
  await supabase.from("limit_breach_events").delete().eq("id", breachId);
  await supabase.from("consumption_limits").delete().eq("id", limitId);
});

describe("runBreachNotifications — retry / terminal-failure", () => {
  it("reaches terminal failure state after 3 failed send attempts and is excluded on the 4th run", async () => {
    vi.mocked(sendPlainTextEmail).mockRejectedValue(new Error("Simulated send failure"));

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- untyped fixture client, see line 61
    await runBreachNotifications(supabase);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- untyped fixture client, see line 61
    await runBreachNotifications(supabase);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- untyped fixture client, see line 61
    await runBreachNotifications(supabase);

    const { data: row } = await supabase
      .from("limit_breach_events")
      .select("notification_attempt_count, notification_failed_at, notified_at")
      .eq("id", breachId)
      .single();
    if (!row) throw new Error("Breach row not found after 3 failed runs");

    expect(row.notification_attempt_count).toBe(3);

    expect(row.notification_failed_at).not.toBeNull();

    expect(row.notified_at).toBeNull();

    // 4th run: breach is excluded by notification_failed_at IS NULL filter — no email attempted.
    vi.mocked(sendPlainTextEmail).mockClear();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- untyped fixture client, see line 61
    await runBreachNotifications(supabase);
    expect(vi.mocked(sendPlainTextEmail).mock.calls.length).toBe(0);
  });
});

describe("runBreachNotifications — Resend HTTP-error path", () => {
  it("records one failed attempt and does not crash the batch when sendPlainTextEmail rejects with an HTTP-error shape", async () => {
    // Insert a second breach under the same limit to verify batch isolation
    // (unique constraint on consumption_limits.user_id prevents a second limit row).
    const { data: breach2Data, error: breach2Error } = await supabase
      .from("limit_breach_events")
      .insert({
        limit_id: limitId,
        user_id: userId,
        breached_at: new Date(Date.now() + 1000).toISOString(),
        consumption_kwh: 250,
        notified_at: null,
        notification_failed_at: null,
        notification_attempt_count: 0,
        // Use previous month's window_start — (limit_id, window_start) is unique.
        window_start: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 1)).toISOString(),
      })
      .select("id")
      .single();
    if (breach2Error) throw new Error(`Failed to insert second breach: ${breach2Error.message}`);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- untyped fixture client, see line 61
    const breach2Id: string = breach2Data.id;

    try {
      // First call rejects with the exact error shape email-client.ts:27 produces on a non-2xx Resend response.
      vi.mocked(sendPlainTextEmail).mockRejectedValueOnce(
        new Error("Resend API error (422): Unprocessable Content — invalid email address"),
      );
      // Second call (for the independent breach) succeeds as normal.

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- untyped fixture client, see line 61
      await runBreachNotifications(supabase);

      // The failing breach: one attempt recorded, not yet terminal, never notified.
      const { data: failRow } = await supabase
        .from("limit_breach_events")
        .select("notification_attempt_count, notification_failed_at, notified_at")
        .eq("id", breachId)
        .single();
      if (!failRow) throw new Error("Failing breach row not found");

      expect(failRow.notification_attempt_count).toBe(1);
      expect(failRow.notification_failed_at).toBeNull();
      expect(failRow.notified_at).toBeNull();

      // The independent breach: successfully notified in the same run (batch not poisoned).
      const { data: successRow } = await supabase
        .from("limit_breach_events")
        .select("notified_at")
        .eq("id", breach2Id)
        .single();
      if (!successRow) throw new Error("Success breach row not found");

      expect(successRow.notified_at).not.toBeNull();
    } finally {
      await supabase.from("limit_breach_events").delete().eq("id", breach2Id);
    }
  });
});

describe("runBreachNotifications — idempotency", () => {
  it("sends email on first run", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- untyped fixture client, see line 61
    await runBreachNotifications(supabase);
    expect(vi.mocked(sendPlainTextEmail).mock.calls.length).toBe(1);
    expect(vi.mocked(sendPlainTextEmail).mock.calls[0][0]).toMatchObject({ to: "alarm@example.com" });
  });

  // NOTE: This test covers sequential duplicate runs. A true concurrent race — two
  // dispatchers both fetching the same unnotified row before either writes notified_at —
  // would result in two emails being sent. That gap is accepted at MVP cron cadence
  // (10 * * * * UTC, single-instance deployment). Sequential idempotency is the
  // achievable guarantee here.
  it("does not send email on second run for same breach", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- untyped fixture client, see line 61
    await runBreachNotifications(supabase);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument -- untyped fixture client, see line 61
    await runBreachNotifications(supabase);
    expect(vi.mocked(sendPlainTextEmail).mock.calls.length).toBe(1);
  });
});
