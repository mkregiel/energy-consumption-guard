import { beforeAll, beforeEach, afterEach, afterAll, describe, it, expect, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from "astro:env/server";
import { syncMeterReading, TuyaClient } from "@/lib/services/tuya-client";
import { runBatchTuyaSync } from "@/lib/services/cron-sync";
import { runScheduledJob } from "@/scheduled";
import { TuyaServiceError } from "@/lib/services/tuya-errors";
import { getMissingTuyaConfigKeys } from "@/lib/services/tuya-config";

// vi.hoisted ensures mockTransport is defined before the vi.mock factory runs.
const mockTransport = vi.hoisted(() => ({
  refreshAccessToken: vi.fn(),
  getDeviceConsumption: vi.fn(),
  getProjectAccessToken: vi.fn(),
  exchangeAuthorizationCode: vi.fn(),
  listUserDevices: vi.fn(),
}));

// Mock at the network boundary — HttpTuyaTransport constructor returns the shared
// mock object so every TuyaClient instance (direct or via createTuyaClient) uses it.
vi.mock("@/lib/services/tuya-http", () => ({
  probeSdkTransportAvailability: vi.fn().mockResolvedValue(undefined),
  HttpTuyaTransport: vi.fn(() => mockTransport),
}));

// Mock tuya-config so tests aren't sensitive to which TUYA_* vars are in .env.test.
// getCloudDeviceReadConfig returns null to keep all tests on the user-OAuth path.
vi.mock("@/lib/services/tuya-config", () => ({
  getMissingTuyaConfigKeys: vi.fn().mockReturnValue([]),
  getTuyaConfig: vi.fn().mockReturnValue({
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    baseUrl: "https://openapi.tuyaus.com",
    region: "us",
    authMode: "app",
    appIdentifier: "",
  }),
  getCloudDeviceReadConfig: vi.fn().mockReturnValue(null),
  getTuyaOAuthRedirectUri: vi.fn().mockReturnValue("https://127.0.0.1:3000/callback"),
  getTuyaOAuthScope: vi.fn().mockReturnValue("devicemessage"),
  buildTuyaOAuthAuthorizeUrl: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Shared fixture values
// ---------------------------------------------------------------------------

const NOW = Date.now();

const mockSnapshot = {
  kwhCumulative: 100.5,
  recordedAt: new Date(NOW).toISOString(),
  sourceCode: "t1",
  valueKind: "cumulative" as const,
};

const freshTokenResult = {
  accessToken: "fresh-access-token",
  refreshToken: "fresh-refresh-token",
  expiresInSeconds: 7200,
  uid: "test-uid",
};

// ---------------------------------------------------------------------------
// Suite-level state
// ---------------------------------------------------------------------------

// Untyped client — same rationale as breach-notifications-idempotency.test.ts:61-66
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let supabase: ReturnType<typeof createClient<any, any, any>>;
let userId: string;
let meterId: string;

beforeAll(async () => {
  supabase = createClient(SUPABASE_URL ?? "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY ?? "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Guard: clean up leftover user from a previously aborted run.
  const { data: existingUsers } = await supabase.auth.admin.listUsers();
  const existing = existingUsers.users.find((u) => u.email === "test-tuya-sync@example.com");
  if (existing) await supabase.auth.admin.deleteUser(existing.id);

  const { data, error } = await supabase.auth.admin.createUser({
    email: "test-tuya-sync@example.com",
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
  mockTransport.refreshAccessToken.mockReset();
  mockTransport.getDeviceConsumption.mockReset();
  vi.mocked(getMissingTuyaConfigKeys).mockReturnValue([]);

  const { data: meterData, error: meterError } = await supabase
    .from("meters")
    .insert({ user_id: userId, label: "test-meter", tuya_device_id: "test-device-id" })
    .select("id")
    .single();
  if (meterError) throw new Error(`Failed to insert meter: ${meterError.message}`);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  meterId = meterData.id;
});

afterEach(async () => {
  await supabase.from("consumption_readings").delete().eq("meter_id", meterId);
  await supabase.from("tuya_oauth_tokens").delete().eq("user_id", userId);
  await supabase.from("meters").delete().eq("id", meterId);
});

// ---------------------------------------------------------------------------
// T1 — Expired token → refresh fires → sync completes
// ---------------------------------------------------------------------------

describe("T1 — expired token → refresh fires → sync completes", () => {
  it("updates tuya_oauth_tokens in DB and creates a consumption_readings row", async () => {
    await supabase.from("tuya_oauth_tokens").insert({
      user_id: userId,
      access_token: "old-token",
      refresh_token: "old-refresh-token",
      access_token_expires_at: new Date(NOW - 120_000).toISOString(),
      refresh_token_expires_at: null,
      tuya_uid: "test-uid",
    });

    mockTransport.refreshAccessToken.mockResolvedValue(freshTokenResult);
    mockTransport.getDeviceConsumption.mockResolvedValue(mockSnapshot);

    const client = new TuyaClient(mockTransport, "http");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await syncMeterReading(supabase, client, userId, { meterId });

    const { data: tokenRow } = await supabase
      .from("tuya_oauth_tokens")
      .select("access_token")
      .eq("user_id", userId)
      .single();
    expect(tokenRow?.access_token).toBe("fresh-access-token");

    const { data: readings } = await supabase.from("consumption_readings").select("id").eq("meter_id", meterId);
    expect(readings).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// T2 — Fresh token locally, Tuya returns 1010 → retry succeeds
// ---------------------------------------------------------------------------

describe("T2 — fresh token locally but Tuya returns 1010 → retry succeeds", () => {
  it("calls refreshAccessToken once and creates a consumption_readings row", async () => {
    await supabase.from("tuya_oauth_tokens").insert({
      user_id: userId,
      access_token: "fresh-local-token",
      refresh_token: "refresh-token",
      access_token_expires_at: new Date(NOW + 600_000).toISOString(),
      refresh_token_expires_at: null,
      tuya_uid: "test-uid",
    });

    mockTransport.getDeviceConsumption
      .mockRejectedValueOnce(new TuyaServiceError("TUYA_TOKEN_EXPIRED", "Token expired server-side", 401))
      .mockResolvedValueOnce(mockSnapshot);
    mockTransport.refreshAccessToken.mockResolvedValue(freshTokenResult);

    const client = new TuyaClient(mockTransport, "http");
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await syncMeterReading(supabase, client, userId, { meterId });

    expect(mockTransport.refreshAccessToken).toHaveBeenCalledTimes(1);

    const { data: readings } = await supabase.from("consumption_readings").select("id").eq("meter_id", meterId);
    expect(readings).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// T3 — Both refresh attempts fail → errors non-empty + no reading written
// ---------------------------------------------------------------------------

describe("T3 — both refresh attempts fail → errors non-empty + no reading written", () => {
  it("returns non-empty errors array and writes no consumption_readings row", async () => {
    await supabase.from("tuya_oauth_tokens").insert({
      user_id: userId,
      access_token: "old-token",
      refresh_token: "old-refresh-token",
      access_token_expires_at: new Date(NOW - 120_000).toISOString(),
      refresh_token_expires_at: null,
      tuya_uid: "test-uid",
    });

    mockTransport.refreshAccessToken.mockRejectedValue(new Error("Refresh failed"));

    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const result = await runBatchTuyaSync(supabase);

    expect(result.errors.length).toBeGreaterThan(0);

    const { data: readings } = await supabase.from("consumption_readings").select("id").eq("meter_id", meterId);
    expect(readings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// T4 — Fatal config error re-throws from runScheduledJob()
// ---------------------------------------------------------------------------

describe("T4 — fatal config error re-throws from runScheduledJob()", () => {
  it("rejects when Tuya config keys are missing", async () => {
    vi.mocked(getMissingTuyaConfigKeys).mockReturnValueOnce(["TUYA_CLIENT_ID"]);

    const controller = { cron: "0 * * * *", scheduledTime: Date.now(), type: "scheduled" as const };
    await expect(runScheduledJob(controller)).rejects.toThrow();
  });
});
