/* eslint-disable no-console */
import { createClient } from "@supabase/supabase-js";

// ── minimal DB types for this script ─────────────────────────────────────────
// Full codegen types would live in src/database.types.ts; these cover only
// the tables the seed script touches.

interface ScriptDb {
  public: {
    Tables: {
      meters: {
        Row: {
          id: string;
          user_id: string;
          label: string;
          tuya_device_id: string;
          tuya_product_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          label: string;
          tuya_device_id: string;
          tuya_product_id?: string | null;
        };
        Update: { user_id?: string; label?: string; tuya_device_id?: string; tuya_product_id?: string | null };
        Relationships: [];
      };
      consumption_limits: {
        Row: {
          id: string;
          user_id: string;
          threshold_kwh: number;
          window_type: string;
          timezone: string;
          created_at: string;
          updated_at: string;
        };
        Insert: { user_id: string; threshold_kwh: number; window_type: string; timezone: string };
        Update: { threshold_kwh?: number; window_type?: string; timezone?: string };
        Relationships: [];
      };
      consumption_readings: {
        Row: {
          id: string;
          meter_id: string;
          recorded_at: string;
          kwh_cumulative: number;
          kwh_delta: number | null;
          source: string;
          created_at: string;
        };
        Insert: {
          meter_id: string;
          recorded_at: string;
          kwh_cumulative: number;
          kwh_delta?: number | null;
          source?: string;
        };
        Update: { kwh_cumulative?: number; kwh_delta?: number | null };
        Relationships: [];
      };
      notification_settings: {
        Row: { user_id: string; alarm_email: string; updated_at: string };
        Insert: { user_id: string; alarm_email: string };
        Update: { alarm_email?: string };
        Relationships: [];
      };
      limit_breach_events: {
        Row: {
          id: string;
          limit_id: string;
          user_id: string;
          breached_at: string;
          consumption_kwh: number;
          notified_at: string | null;
          notification_attempt_count: number;
          notification_failed_at: string | null;
          window_start: string | null;
          created_at: string;
        };
        Insert: {
          limit_id: string;
          user_id: string;
          breached_at: string;
          consumption_kwh: number;
          window_start?: string | null;
        };
        Update: {
          notified_at?: string | null;
          notification_attempt_count?: number;
          notification_failed_at?: string | null;
        };
        Relationships: [];
      };
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
  };
}

// ── env validation ────────────────────────────────────────────────────────────

const REQUIRED_ENV = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "CRON_SECRET",
  "APP_BASE_URL",
  "TEST_USER_ID",
  "TEST_EMAIL",
] as const;

type EnvKey = (typeof REQUIRED_ENV)[number];
type Env = Record<EnvKey, string>;

function loadEnv(): Env {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error("Missing required environment variables:");
    for (const key of missing) {
      console.error(`  ${key}`);
    }
    console.error("\nUsage:");
    console.error(
      "  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... CRON_SECRET=... APP_BASE_URL=... TEST_USER_ID=... TEST_EMAIL=... npm run seed:test-breach [-- --cleanup]",
    );
    process.exit(1);
  }
  const result = Object.fromEntries(REQUIRED_ENV.map((key) => [key, process.env[key]])) as Env;

  // Guard: service role key must be a JWT (three base64url parts starting with eyJ).
  // A common mistake is supplying the raw JWT Secret instead of the service_role token.
  if (!result.SUPABASE_SERVICE_ROLE_KEY.startsWith("eyJ")) {
    console.error("SUPABASE_SERVICE_ROLE_KEY does not look like a JWT (should start with 'eyJ...').");
    console.error("In Supabase Dashboard → Settings → API, use the 'service_role' token, not the 'JWT Secret'.");
    process.exit(1);
  }

  return result;
}

// ── module-scope state (populated in main before any helper is called) ────────

let env: Env;
// definite assignment: set in main() before helpers run
let supabase!: ReturnType<typeof createClient<ScriptDb>>;

// ── types ─────────────────────────────────────────────────────────────────────

interface SeedIds {
  meterId: string;
  limitId: string;
  readingId: string;
}

// ── seed ──────────────────────────────────────────────────────────────────────

async function seed(): Promise<SeedIds> {
  // 1. Meter — select-or-insert (avoids onConflict PostgREST non-PK issue)
  const existingMeter = await supabase.from("meters").select("id").eq("user_id", env.TEST_USER_ID).maybeSingle();
  if (existingMeter.error) throw new Error(`Meter lookup failed: ${existingMeter.error.message}`);
  let meterId: string;
  if (existingMeter.data) {
    meterId = existingMeter.data.id;
    console.log(`✓ Meter found (existing): ${meterId}`);
  } else {
    const meterInsert = await supabase
      .from("meters")
      .insert({ user_id: env.TEST_USER_ID, label: "[test] seed-test-breach", tuya_device_id: "test-seed-device-id" })
      .select("id")
      .single();
    if (meterInsert.error) throw new Error(`Meter insert failed: ${meterInsert.error.message}`);
    meterId = meterInsert.data.id;
    console.log(`✓ Meter inserted: ${meterId}`);
  }

  // 2. Consumption limit — select-or-insert (avoids onConflict PostgREST non-PK issue)
  const existingLimit = await supabase
    .from("consumption_limits")
    .select("id, threshold_kwh, window_type, timezone")
    .eq("user_id", env.TEST_USER_ID)
    .maybeSingle();
  if (existingLimit.error) throw new Error(`Limit lookup failed: ${existingLimit.error.message}`);
  let limitId: string;
  if (existingLimit.data) {
    const { threshold_kwh, window_type, timezone } = existingLimit.data;
    console.warn(
      `⚠ Overwriting real consumption limit (${threshold_kwh} kWh, ${window_type}, ${timezone}) with test values. Run --cleanup or restore manually after testing.`,
    );
    // Overwrite threshold/window to guarantee the test values are active
    const limitUpdate = await supabase
      .from("consumption_limits")
      .update({ threshold_kwh: 0.01, window_type: "day", timezone: "Europe/Warsaw" })
      .eq("id", existingLimit.data.id)
      .select("id")
      .single();
    if (limitUpdate.error) throw new Error(`Limit update failed: ${limitUpdate.error.message}`);
    limitId = limitUpdate.data.id;
    console.log(`✓ Consumption limit updated: ${limitId}`);
  } else {
    const limitInsert = await supabase
      .from("consumption_limits")
      .insert({ user_id: env.TEST_USER_ID, threshold_kwh: 0.01, window_type: "day", timezone: "Europe/Warsaw" })
      .select("id")
      .single();
    if (limitInsert.error) throw new Error(`Limit insert failed: ${limitInsert.error.message}`);
    limitId = limitInsert.data.id;
    console.log(`✓ Consumption limit inserted: ${limitId}`);
  }

  // 3. Consumption reading — insert one row exceeding the 0.01 kWh threshold
  // NOTE: Re-running without --cleanup on the same calendar day will leave orphaned readings
  // and the evaluator will see the existing breach for today's window_start, returning "breached: 0".
  // Run with --cleanup between tests, or wait until the next UTC day.
  const readingInsert = await supabase
    .from("consumption_readings")
    .insert({
      meter_id: meterId,
      recorded_at: new Date().toISOString(),
      kwh_cumulative: 0.05,
      kwh_delta: 0.05,
      source: "manual",
    })
    .select("id")
    .single();
  if (readingInsert.error) throw new Error(`Reading insert failed: ${readingInsert.error.message}`);
  const readingId = readingInsert.data.id;
  console.log(`✓ Consumption reading inserted: ${readingId}`);

  // 4. Notification settings — upsert using PK (user_id IS the PK, no onConflict needed)
  const existingSettings = await supabase
    .from("notification_settings")
    .select("alarm_email")
    .eq("user_id", env.TEST_USER_ID)
    .maybeSingle();
  if (existingSettings.error) throw new Error(`Settings lookup failed: ${existingSettings.error.message}`);
  if (existingSettings.data) {
    console.warn(`⚠ Overwriting existing alarm_email (${existingSettings.data.alarm_email}) for test user`);
  }
  const settingsUpsert = await supabase
    .from("notification_settings")
    .upsert({ user_id: env.TEST_USER_ID, alarm_email: env.TEST_EMAIL });
  if (settingsUpsert.error) throw new Error(`Notification settings upsert failed: ${settingsUpsert.error.message}`);
  console.log(`✓ Notification settings upserted (alarm_email: ${env.TEST_EMAIL})`);

  return { meterId, limitId, readingId };
}

// ── cron triggers ─────────────────────────────────────────────────────────────

async function triggerCron(cronPath: string): Promise<void> {
  const url = `${env.APP_BASE_URL}${cronPath}`;
  console.log(`\n→ POST ${url}`);
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.CRON_SECRET}`, "Content-Type": "application/json" },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`${cronPath} failed (${response.status}): ${body}`);
  }
  try {
    console.log(JSON.stringify(JSON.parse(body) as unknown, null, 2));
  } catch {
    console.log(body);
  }
}

// ── cleanup ───────────────────────────────────────────────────────────────────

async function cleanup({ meterId, limitId, readingId }: SeedIds): Promise<void> {
  console.log("\n── Cleanup ──────────────────────────────────────────────────────");

  // Reverse FK order: readings → breaches → limits → meters → settings
  const readingDel = await supabase.from("consumption_readings").delete({ count: "exact" }).eq("id", readingId);
  if (readingDel.error) throw new Error(`Reading delete failed: ${readingDel.error.message}`);
  console.log(`✓ Deleted ${readingDel.count ?? 0} consumption_reading(s)`);

  // limit_breach_events reference consumption_limits — delete before limits
  const breachDel = await supabase.from("limit_breach_events").delete({ count: "exact" }).eq("limit_id", limitId);
  if (breachDel.error) throw new Error(`Breach events delete failed: ${breachDel.error.message}`);
  console.log(`✓ Deleted ${breachDel.count ?? 0} limit_breach_event(s)`);

  const limitDel = await supabase.from("consumption_limits").delete({ count: "exact" }).eq("id", limitId);
  if (limitDel.error) throw new Error(`Limit delete failed: ${limitDel.error.message}`);
  console.log(`✓ Deleted ${limitDel.count ?? 0} consumption_limit(s)`);

  const meterDel = await supabase.from("meters").delete({ count: "exact" }).eq("id", meterId);
  if (meterDel.error) throw new Error(`Meter delete failed: ${meterDel.error.message}`);
  console.log(`✓ Deleted ${meterDel.count ?? 0} meter(s)`);

  const settingsDel = await supabase
    .from("notification_settings")
    .delete({ count: "exact" })
    .eq("user_id", env.TEST_USER_ID);
  if (settingsDel.error) throw new Error(`Notification settings delete failed: ${settingsDel.error.message}`);
  console.log(`✓ Deleted ${settingsDel.count ?? 0} notification_settings row(s)`);
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const doCleanup = process.argv.includes("--cleanup");
  env = loadEnv();
  // auth options required for service-role clients in Node.js
  supabase = createClient<ScriptDb>(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── connectivity probe ──────────────────────────────────────────────────────
  // Direct fetch to PostgREST — bypasses the supabase-js client layer so we
  // see the raw HTTP status and error body if auth fails.
  const probeUrl = `${env.SUPABASE_URL}/rest/v1/meters?select=id&user_id=eq.${env.TEST_USER_ID}&limit=1`;
  console.log(`Probe: GET ${probeUrl}`);
  const probeRes = await fetch(probeUrl, {
    headers: {
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    },
  });
  const probeBody = await probeRes.text();
  if (!probeRes.ok) {
    console.error(`Probe failed (HTTP ${probeRes.status}): ${probeBody}`);
    process.exit(1);
  }
  console.log(`Probe OK (HTTP ${probeRes.status})\n`);
  // ────────────────────────────────────────────────────────────────────────────

  console.log("── Seeding test data ─────────────────────────────────────────────");
  const seedIds = await seed();

  console.log("\n── Triggering cron jobs ──────────────────────────────────────────");
  await triggerCron("/api/cron/evaluate-limits");
  await triggerCron("/api/cron/send-notifications");

  if (doCleanup) {
    await cleanup(seedIds);
    console.log("\n✓ Cleanup complete.");
  } else {
    console.log("\nTip: Run with --cleanup to delete test rows after verification.");
    console.log(`    limitId for manual inspection: ${seedIds.limitId}`);
  }

  console.log("\n✓ Done.");
}

main().catch((err: unknown) => {
  console.error("\n✗ Script failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
