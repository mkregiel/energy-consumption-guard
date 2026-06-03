import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConsumptionLimit, LimitUpsertPayload } from "@/types";
import { TuyaServiceError } from "@/lib/services/tuya-errors";

export const getUserLimit = async (supabase: SupabaseClient, userId: string): Promise<ConsumptionLimit | null> => {
  const response = await supabase.from("consumption_limits").select("*").eq("user_id", userId).maybeSingle();

  if (response.error) {
    throw new TuyaServiceError("LIMIT_DB_ERROR", "Failed to load consumption limit.", 500, response.error);
  }

  return response.data as ConsumptionLimit | null;
};

export const upsertUserLimit = async (
  supabase: SupabaseClient,
  userId: string,
  payload: LimitUpsertPayload,
): Promise<ConsumptionLimit> => {
  const response = await supabase
    .from("consumption_limits")
    .upsert(
      {
        user_id: userId,
        threshold_kwh: payload.threshold_kwh,
        window_type: payload.window_type,
        timezone: "Europe/Warsaw", // MVP: hardcoded per plan; S-04 can add a timezone picker
      },
      { onConflict: "user_id" },
    )
    .select("*")
    .single();

  if (response.error) {
    throw new TuyaServiceError("LIMIT_DB_ERROR", "Failed to save consumption limit.", 500, response.error);
  }

  return response.data as ConsumptionLimit;
};
