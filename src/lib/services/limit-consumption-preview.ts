import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConsumptionLimit } from "@/types";
import { getWindowBounds, toIso } from "@/lib/services/consumption-window";

export interface LimitWindowPreview {
  consumptionKwh: number;
  windowStart: string;
  windowEnd: string;
  hasReadings: boolean;
}

export const getLimitWindowPreview = async (
  supabase: SupabaseClient,
  meterId: string,
  limit: ConsumptionLimit,
): Promise<LimitWindowPreview> => {
  const { windowStart, windowEnd } = getWindowBounds(limit.window_type, limit.timezone);
  const windowStartIso = toIso(windowStart);
  const windowEndIso = toIso(windowEnd);

  const response = await supabase
    .from("consumption_readings")
    .select("kwh_delta")
    .eq("meter_id", meterId)
    .gte("recorded_at", windowStartIso)
    .lt("recorded_at", windowEndIso);

  if (response.error) {
    throw new Error(`Failed to load window readings: ${response.error.message}`);
  }

  const rows = response.data as { kwh_delta: number | null }[];
  const consumptionKwh = rows.reduce((sum, row) => sum + (row.kwh_delta ?? 0), 0);

  return {
    consumptionKwh,
    windowStart: windowStartIso,
    windowEnd: windowEndIso,
    hasReadings: rows.length > 0,
  };
};
