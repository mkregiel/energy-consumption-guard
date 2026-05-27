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
