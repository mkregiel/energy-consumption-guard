import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConsumptionReading } from "@/types";

export const CONSUMPTION_READINGS_LIMIT = 20;

export interface ConsumptionDashboardData {
  latestReading: ConsumptionReading | null;
  readings: ConsumptionReading[];
}

export const getMeterConsumptionReadings = async (
  supabase: SupabaseClient,
  meterId: string,
  limit = CONSUMPTION_READINGS_LIMIT,
): Promise<ConsumptionDashboardData> => {
  const response = await supabase
    .from("consumption_readings")
    .select("*")
    .eq("meter_id", meterId)
    .order("recorded_at", { ascending: false })
    .limit(limit);

  if (response.error) {
    throw response.error;
  }

  const readings = response.data as ConsumptionReading[];

  return {
    latestReading: readings[0] ?? null,
    readings,
  };
};
