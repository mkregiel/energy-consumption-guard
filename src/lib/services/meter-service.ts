import type { SupabaseClient } from "@supabase/supabase-js";
import type { Meter, MeterUpsertPayload } from "@/types";
import { TuyaServiceError } from "@/lib/services/tuya-errors";

export const getUserMeter = async (supabase: SupabaseClient, userId: string): Promise<Meter | null> => {
  const response = await supabase.from("meters").select("*").eq("user_id", userId).maybeSingle();

  if (response.error) {
    throw new TuyaServiceError("TUYA_PROVIDER_ERROR", "Failed to load user meter.", 500, response.error);
  }

  return response.data as Meter | null;
};

export const upsertUserMeter = async (
  supabase: SupabaseClient,
  userId: string,
  payload: MeterUpsertPayload,
): Promise<Meter> => {
  const tuyaDeviceId = payload.tuya_device_id.trim();
  if (tuyaDeviceId.length === 0) {
    throw new TuyaServiceError("TUYA_PROVIDER_ERROR", "Meter device ID is required.", 400);
  }

  const response = await supabase
    .from("meters")
    .upsert(
      {
        user_id: userId,
        label: payload.label.trim(),
        tuya_device_id: tuyaDeviceId,
        tuya_product_id: payload.tuya_product_id?.trim() ?? null,
      },
      { onConflict: "user_id" },
    )
    .select("*")
    .single();

  if (response.error) {
    throw new TuyaServiceError("TUYA_PROVIDER_ERROR", "Failed to save user meter.", 500, response.error);
  }

  return response.data as Meter;
};
