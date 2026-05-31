import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConsumptionReading, Meter, TuyaDeviceSummary, TuyaOAuthToken, TuyaOAuthTokenInsert } from "@/types";
import { getCloudDeviceReadConfig, type TuyaConfig } from "@/lib/services/tuya-config";
import {
  HttpTuyaTransport,
  probeSdkTransportAvailability,
  type TuyaConsumptionSnapshot,
  type TuyaDeviceRecord,
  type TuyaTokenResult,
} from "@/lib/services/tuya-http";
import { TuyaServiceError } from "@/lib/services/tuya-errors";

export type TuyaTransportMode = "http" | "sdk";

export interface TuyaTransportAdapter {
  exchangeAuthorizationCode(code: string): Promise<TuyaTokenResult>;
  refreshAccessToken(refreshToken: string): Promise<TuyaTokenResult>;
  getProjectAccessToken(): Promise<TuyaTokenResult>;
  getDeviceConsumption(deviceId: string, accessToken: string): Promise<TuyaConsumptionSnapshot>;
  listUserDevices(uid: string, accessToken: string): Promise<TuyaDeviceRecord[]>;
}

const TOKEN_REFRESH_SKEW_MS = 60_000;

const addSecondsIso = (from: Date, seconds: number): string => new Date(from.getTime() + seconds * 1000).toISOString();

const isAccessTokenExpired = (expiresAt: string, forceRefresh: boolean): boolean => {
  if (forceRefresh) {
    return true;
  }

  const expiresAtMs = Date.parse(expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs - TOKEN_REFRESH_SKEW_MS <= Date.now();
};

export class TuyaClient {
  readonly transportMode: TuyaTransportMode;

  constructor(
    private readonly transport: TuyaTransportAdapter,
    transportMode: TuyaTransportMode,
  ) {
    this.transportMode = transportMode;
  }

  exchangeAuthorizationCode(code: string): Promise<TuyaTokenResult> {
    return this.transport.exchangeAuthorizationCode(code);
  }

  refreshAccessToken(refreshToken: string): Promise<TuyaTokenResult> {
    return this.transport.refreshAccessToken(refreshToken);
  }

  getProjectAccessToken(): Promise<TuyaTokenResult> {
    return this.transport.getProjectAccessToken();
  }

  getDeviceConsumption(deviceId: string, accessToken: string): Promise<TuyaConsumptionSnapshot> {
    return this.transport.getDeviceConsumption(deviceId, accessToken);
  }

  listUserDevices(uid: string, accessToken: string): Promise<TuyaDeviceRecord[]> {
    return this.transport.listUserDevices(uid, accessToken);
  }
}

export const createTuyaClient = async (config: TuyaConfig): Promise<TuyaClient> => {
  await probeSdkTransportAvailability();
  return new TuyaClient(new HttpTuyaTransport(config), "http");
};

export const toTokenInsert = (userId: string, tokens: TuyaTokenResult): TuyaOAuthTokenInsert => {
  const now = new Date();
  return {
    user_id: userId,
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    access_token_expires_at: addSecondsIso(now, tokens.expiresInSeconds),
    refresh_token_expires_at: null,
    tuya_uid: tokens.uid,
  };
};

export const loadUserOAuthToken = async (supabase: SupabaseClient, userId: string): Promise<TuyaOAuthToken | null> => {
  const tokenResponse = await supabase.from("tuya_oauth_tokens").select("*").eq("user_id", userId).maybeSingle();

  if (tokenResponse.error) {
    throw new TuyaServiceError("TUYA_PROVIDER_ERROR", "Failed to load Tuya OAuth token.", 500, tokenResponse.error);
  }

  return tokenResponse.data as TuyaOAuthToken | null;
};

export const saveUserOAuthToken = async (supabase: SupabaseClient, tokenRow: TuyaOAuthTokenInsert): Promise<void> => {
  const { error } = await supabase.from("tuya_oauth_tokens").upsert(tokenRow, { onConflict: "user_id" });

  if (error) {
    throw new TuyaServiceError("TUYA_PROVIDER_ERROR", "Failed to persist Tuya OAuth token.", 500, error);
  }
};

export const resolveAccessToken = async (
  supabase: SupabaseClient,
  client: TuyaClient,
  userId: string,
  forceRefresh: boolean,
): Promise<{ accessToken: string; tuyaUid: string | null }> => {
  const stored = await loadUserOAuthToken(supabase, userId);
  if (!stored) {
    throw new TuyaServiceError("TUYA_NOT_LINKED", "Tuya account is not linked for this user.", 409);
  }

  if (!isAccessTokenExpired(stored.access_token_expires_at, forceRefresh)) {
    return { accessToken: stored.access_token, tuyaUid: stored.tuya_uid };
  }

  const refreshed = await client.refreshAccessToken(stored.refresh_token);
  const tokenRow = toTokenInsert(userId, refreshed);
  await saveUserOAuthToken(supabase, tokenRow);

  return { accessToken: tokenRow.access_token, tuyaUid: tokenRow.tuya_uid };
};

export const resolveUserMeter = async (supabase: SupabaseClient, userId: string, meterId?: string): Promise<Meter> => {
  let query = supabase.from("meters").select("*").eq("user_id", userId);

  if (meterId) {
    query = query.eq("id", meterId);
  }

  const meterResponse = await query.limit(1).maybeSingle();

  if (meterResponse.error) {
    throw new TuyaServiceError("TUYA_PROVIDER_ERROR", "Failed to resolve user meter.", 500, meterResponse.error);
  }

  if (!meterResponse.data) {
    throw new TuyaServiceError(
      "TUYA_METER_NOT_FOUND",
      meterId ? "Meter not found for this user." : "No meter registered for this user.",
      404,
      { meterId: meterId ?? null },
    );
  }

  return meterResponse.data as Meter;
};

export const upsertConsumptionReading = async (
  supabase: SupabaseClient,
  meterId: string,
  snapshot: TuyaConsumptionSnapshot,
): Promise<ConsumptionReading> => {
  const previousResponse = await supabase
    .from("consumption_readings")
    .select("kwh_cumulative, recorded_at")
    .eq("meter_id", meterId)
    .lt("recorded_at", snapshot.recordedAt)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const previousReading = previousResponse.data;

  const previousKwh =
    previousReading && typeof previousReading.kwh_cumulative === "number" ? previousReading.kwh_cumulative : null;

  let kwhCumulative: number;
  let kwhDelta: number | null;

  if (snapshot.valueKind === "period") {
    kwhDelta = snapshot.kwhCumulative;
    kwhCumulative = previousKwh === null ? snapshot.kwhCumulative : previousKwh + snapshot.kwhCumulative;
  } else {
    kwhCumulative = snapshot.kwhCumulative;
    kwhDelta = previousKwh === null ? null : Math.max(0, snapshot.kwhCumulative - previousKwh);
  }

  const readingResponse = await supabase
    .from("consumption_readings")
    .upsert(
      {
        meter_id: meterId,
        recorded_at: snapshot.recordedAt,
        kwh_cumulative: kwhCumulative,
        kwh_delta: kwhDelta,
        source: "tuya",
      },
      { onConflict: "meter_id,recorded_at" },
    )
    .select("*")
    .single();

  if (readingResponse.error) {
    throw new TuyaServiceError(
      "TUYA_PROVIDER_ERROR",
      "Failed to persist consumption reading.",
      500,
      readingResponse.error,
    );
  }

  return readingResponse.data as ConsumptionReading;
};

export const linkTuyaAccount = async (
  supabase: SupabaseClient,
  client: TuyaClient,
  userId: string,
  code: string,
): Promise<{ linked: true; tuyaUid: string; accessTokenExpiresAt: string }> => {
  const tokens = await client.exchangeAuthorizationCode(code);
  const tokenRow = toTokenInsert(userId, tokens);
  await saveUserOAuthToken(supabase, tokenRow);

  return {
    linked: true,
    tuyaUid: tokens.uid,
    accessTokenExpiresAt: tokenRow.access_token_expires_at,
  };
};

export const assertTuyaAccountLinked = async (supabase: SupabaseClient, userId: string): Promise<TuyaOAuthToken> => {
  const stored = await loadUserOAuthToken(supabase, userId);
  if (!stored) {
    throw new TuyaServiceError("TUYA_NOT_LINKED", "Tuya account is not linked for this user.", 409);
  }

  return stored;
};

export const getTuyaConnectionStatus = async (
  supabase: SupabaseClient,
  userId: string,
): Promise<{ linked: boolean; accessTokenExpiresAt: string | null; tuyaUid: string | null }> => {
  const stored = await loadUserOAuthToken(supabase, userId);
  if (!stored) {
    return { linked: false, accessTokenExpiresAt: null, tuyaUid: null };
  }

  return {
    linked: true,
    accessTokenExpiresAt: stored.access_token_expires_at,
    tuyaUid: stored.tuya_uid,
  };
};

const toDeviceSummary = (device: TuyaDeviceRecord): TuyaDeviceSummary => ({
  deviceId: device.id,
  name: device.name,
  productId: device.productId,
  online: device.online,
});

export const listLinkedUserDevices = async (
  supabase: SupabaseClient,
  client: TuyaClient,
  userId: string,
): Promise<TuyaDeviceSummary[]> => {
  const { accessToken, tuyaUid } = await resolveAccessToken(supabase, client, userId, false);
  if (!tuyaUid) {
    throw new TuyaServiceError("TUYA_NOT_LINKED", "Tuya account is not linked for this user.", 409);
  }

  const cloudConfig = getCloudDeviceReadConfig();
  if (cloudConfig) {
    const cloudClient = createCloudTuyaClient();
    const projectTokens = await cloudClient.getProjectAccessToken();
    const devices = await cloudClient.listUserDevices(tuyaUid, projectTokens.accessToken);
    return devices.map(toDeviceSummary);
  }

  const devices = await client.listUserDevices(tuyaUid, accessToken);
  return devices.map(toDeviceSummary);
};

export const assertMeterDeviceAllowed = async (
  supabase: SupabaseClient,
  client: TuyaClient,
  userId: string,
  tuyaDeviceId: string,
): Promise<void> => {
  let devices: TuyaDeviceSummary[];

  try {
    devices = await listLinkedUserDevices(supabase, client, userId);
  } catch (error) {
    if (error instanceof TuyaServiceError && error.code === "TUYA_NOT_LINKED") {
      throw error;
    }

    return;
  }

  if (devices.length === 0) {
    return;
  }

  const owned = devices.some((device) => device.deviceId === tuyaDeviceId);
  if (!owned) {
    throw new TuyaServiceError("TUYA_PROVIDER_ERROR", "Device ID is not linked to your Tuya account.", 400);
  }
};

const createCloudTuyaClient = (): TuyaClient => {
  const cloudConfig = getCloudDeviceReadConfig();
  if (!cloudConfig) {
    throw new TuyaServiceError("TUYA_CONFIG_MISSING", "Cloud device read credentials are not configured.", 500);
  }

  return new TuyaClient(new HttpTuyaTransport(cloudConfig), "http");
};

export const syncMeterReading = async (
  supabase: SupabaseClient,
  client: TuyaClient,
  userId: string,
  options: { meterId?: string; forceRefresh?: boolean },
): Promise<{ meter: Meter; reading: ConsumptionReading; transportMode: TuyaTransportMode }> => {
  const meter = await resolveUserMeter(supabase, userId, options.meterId);
  const cloudConfig = getCloudDeviceReadConfig();

  let snapshot: TuyaConsumptionSnapshot;
  if (cloudConfig) {
    await assertTuyaAccountLinked(supabase, userId);
    const cloudClient = createCloudTuyaClient();
    const projectTokens = await cloudClient.getProjectAccessToken();
    snapshot = await cloudClient.getDeviceConsumption(meter.tuya_device_id, projectTokens.accessToken);
  } else {
    const { accessToken } = await resolveAccessToken(supabase, client, userId, options.forceRefresh ?? false);
    snapshot = await client.getDeviceConsumption(meter.tuya_device_id, accessToken);
  }

  const reading = await upsertConsumptionReading(supabase, meter.id, snapshot);

  return { meter, reading, transportMode: client.transportMode };
};
