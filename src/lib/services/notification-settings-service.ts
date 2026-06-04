import type { SupabaseClient } from "@supabase/supabase-js";
import type { NotificationSettings } from "@/types";
import { TuyaServiceError } from "@/lib/services/tuya-errors";

export const getUserNotificationSettings = async (
  supabase: SupabaseClient,
  userId: string,
): Promise<NotificationSettings | null> => {
  const response = await supabase.from("notification_settings").select("*").eq("user_id", userId).maybeSingle();

  if (response.error) {
    throw new TuyaServiceError(
      "NOTIFICATION_SETTINGS_DB_ERROR",
      "Failed to load notification settings.",
      500,
      response.error,
    );
  }

  return response.data as NotificationSettings | null;
};

export const upsertNotificationSettings = async (
  supabase: SupabaseClient,
  userId: string,
  alarmEmail: string,
): Promise<NotificationSettings> => {
  const response = await supabase
    .from("notification_settings")
    .upsert({ user_id: userId, alarm_email: alarmEmail }, { onConflict: "user_id" })
    .select("*")
    .single();

  if (response.error) {
    throw new TuyaServiceError(
      "NOTIFICATION_SETTINGS_DB_ERROR",
      "Failed to save notification settings.",
      500,
      response.error,
    );
  }

  return response.data as NotificationSettings;
};
