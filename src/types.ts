/** Calendar window for consumption limit thresholds (matches `consumption_limits.window_type`). */
export type WindowType = "day" | "week" | "month";

/** Origin of a consumption reading row (matches `consumption_readings.source`). */
export type ReadingSource = "tuya" | "manual";

export interface Meter {
  id: string;
  user_id: string;
  label: string;
  tuya_device_id: string;
  tuya_product_id: string | null;
  created_at: string;
  updated_at: string;
}

export type MeterInsert = Omit<Meter, "id" | "created_at" | "updated_at">;

export interface ConsumptionLimit {
  id: string;
  user_id: string;
  threshold_kwh: number;
  window_type: WindowType;
  timezone: string;
  created_at: string;
  updated_at: string;
}

export type ConsumptionLimitInsert = Omit<ConsumptionLimit, "id" | "created_at" | "updated_at">;

export interface ConsumptionReading {
  id: string;
  meter_id: string;
  recorded_at: string;
  kwh_cumulative: number;
  kwh_delta: number | null;
  source: ReadingSource;
  created_at: string;
}

export type ConsumptionReadingInsert = Omit<ConsumptionReading, "id" | "created_at">;

export interface NotificationSettings {
  user_id: string;
  alarm_email: string;
  updated_at: string;
}

export type NotificationSettingsInsert = Omit<NotificationSettings, "updated_at">;

export interface LimitBreachEvent {
  id: string;
  limit_id: string;
  user_id: string;
  breached_at: string;
  consumption_kwh: number;
  notified_at: string | null;
  created_at: string;
}

export type LimitBreachEventInsert = Omit<LimitBreachEvent, "id" | "created_at">;

/** Per-user Tuya OAuth credentials (matches `tuya_oauth_tokens`). */
export interface TuyaOAuthToken {
  user_id: string;
  access_token: string;
  refresh_token: string;
  access_token_expires_at: string;
  refresh_token_expires_at: string | null;
  tuya_uid: string | null;
  created_at: string;
  updated_at: string;
}

export type TuyaOAuthTokenInsert = Omit<TuyaOAuthToken, "created_at" | "updated_at">;

export type TuyaOAuthTokenUpdate = Pick<
  TuyaOAuthToken,
  "access_token" | "refresh_token" | "access_token_expires_at" | "refresh_token_expires_at" | "tuya_uid"
>;

/** Token metadata safe to expose in API responses (no secrets). */
export interface TuyaConnectionStatus {
  linked: boolean;
  accessTokenExpiresAt: string | null;
  tuyaUid: string | null;
}

/** Device row returned by GET /api/tuya/devices. */
export interface TuyaDeviceSummary {
  deviceId: string;
  name: string;
  productId?: string;
  online?: boolean;
}

/** GET /api/tuya/devices success payload. */
export interface TuyaDevicesResult {
  devices: TuyaDeviceSummary[];
}

/** POST /api/meters request body. */
export interface MeterUpsertPayload {
  label: string;
  tuya_device_id: string;
  tuya_product_id?: string;
}

/** POST /api/tuya/oauth/callback request body. */
export interface TuyaOAuthCallbackPayload {
  code: string;
  state: string;
}

/** POST /api/tuya/oauth/callback success payload. */
export interface TuyaOAuthCallbackResult {
  linked: boolean;
  status: "accepted" | "linked";
  message?: string;
}

/** POST /api/tuya/sync request body. */
export interface TuyaSyncPayload {
  meterId?: string;
  forceRefresh?: boolean;
}

/** POST /api/tuya/sync success payload. */
export interface TuyaSyncResult {
  status: "accepted" | "synced";
  synced: boolean;
  meterId: string | null;
  forceRefresh?: boolean;
  reading?: ConsumptionReading;
  message?: string;
}

/** Standard JSON envelope for F-02 Tuya API routes. */
export interface TuyaApiSuccess<T> {
  ok: true;
  data: T;
}

export interface TuyaApiErrorBody {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
