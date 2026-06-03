import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConsumptionLimit, LimitUpsertPayload } from "@/types";

export const getUserLimit = async (supabase: SupabaseClient, userId: string): Promise<ConsumptionLimit | null> => {
  const response = await supabase.from("consumption_limits").select("*").eq("user_id", userId).maybeSingle();

  if (response.error) {
    throw new Error(`Failed to load consumption limit: ${response.error.message}`);
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
        timezone: "Europe/Warsaw",
      },
      { onConflict: "user_id" },
    )
    .select("*")
    .single();

  if (response.error) {
    throw new Error(`Failed to save consumption limit: ${response.error.message}`);
  }

  return response.data as ConsumptionLimit;
};
