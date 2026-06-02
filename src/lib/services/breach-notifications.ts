import type { SupabaseClient } from "@supabase/supabase-js";
import { buildBreachAlarmEmail } from "@/lib/services/breach-email-content";
import { toIso } from "@/lib/services/consumption-window";
import { isResendConfigured, sendPlainTextEmail } from "@/lib/services/email-client";
import type { ConsumptionLimit, LimitBreachEvent, NotificationSettings } from "@/types";

export interface BreachNotificationJobResult {
  job: "send-notifications";
  startedAt: string;
  finishedAt: string;
  stats: { processed: number; sent: number; skipped: number; failed: number; errors: number };
  errors: { userId?: string; breachId?: string; code: string; message: string }[];
}

const MAX_NOTIFICATION_ATTEMPTS = 3;

type BreachWithLimit = LimitBreachEvent & {
  consumption_limits: Pick<ConsumptionLimit, "threshold_kwh" | "window_type" | "timezone"> | null;
};

const emptyStats = () => ({ processed: 0, sent: 0, skipped: 0, failed: 0, errors: 0 });

export const runBreachNotifications = async (supabase: SupabaseClient): Promise<BreachNotificationJobResult> => {
  if (!isResendConfigured()) {
    throw new Error("RESEND_NOT_CONFIGURED");
  }

  const startedAt = toIso(new Date());
  const stats = emptyStats();
  const errors: BreachNotificationJobResult["errors"] = [];

  const breachesResponse = await supabase
    .from("limit_breach_events")
    .select("*, consumption_limits(threshold_kwh, window_type, timezone)")
    .is("notified_at", null)
    .is("notification_failed_at", null)
    .order("breached_at", { ascending: true });

  if (breachesResponse.error) {
    throw new Error(`Failed to load breach events: ${breachesResponse.error.message}`);
  }

  const breaches = breachesResponse.data as BreachWithLimit[];

  for (const breach of breaches) {
    stats.processed++;

    try {
      const settingsResponse = await supabase
        .from("notification_settings")
        .select("*")
        .eq("user_id", breach.user_id)
        .maybeSingle();

      if (settingsResponse.error) {
        throw new Error(`Failed to load notification settings: ${settingsResponse.error.message}`);
      }

      const settings = settingsResponse.data as NotificationSettings | null;

      if (!settings) {
        stats.skipped++;
        stats.errors++;
        errors.push({
          userId: breach.user_id,
          breachId: breach.id,
          code: "NO_NOTIFICATION_SETTINGS",
          message: "No notification_settings row for user.",
        });
        continue;
      }

      const limit = breach.consumption_limits;
      if (!limit) {
        stats.skipped++;
        stats.errors++;
        errors.push({
          userId: breach.user_id,
          breachId: breach.id,
          code: "LIMIT_NOT_FOUND",
          message: "Consumption limit metadata missing for breach.",
        });
        continue;
      }

      const email = buildBreachAlarmEmail({
        consumptionKwh: breach.consumption_kwh,
        thresholdKwh: limit.threshold_kwh,
        windowType: limit.window_type,
        timezone: limit.timezone,
        breachedAt: breach.breached_at,
        windowStart: breach.window_start,
      });

      try {
        await sendPlainTextEmail({
          to: settings.alarm_email,
          subject: email.subject,
          text: email.text,
        });
      } catch (sendError) {
        const attemptCount = breach.notification_attempt_count + 1;
        const nowIso = toIso(new Date());
        const terminalFailure = attemptCount >= MAX_NOTIFICATION_ATTEMPTS;

        const updateResponse = await supabase
          .from("limit_breach_events")
          .update({
            notification_attempt_count: attemptCount,
            notification_failed_at: terminalFailure ? nowIso : null,
          })
          .eq("id", breach.id);

        if (updateResponse.error) {
          throw new Error(`Failed to update notification attempt count: ${updateResponse.error.message}`);
        }

        stats.failed++;
        stats.errors++;
        const message = sendError instanceof Error ? sendError.message : "Unknown Resend send error.";
        errors.push({
          userId: breach.user_id,
          breachId: breach.id,
          code: terminalFailure ? "NOTIFICATION_FAILED_TERMINAL" : "NOTIFICATION_SEND_FAILED",
          message,
        });
        console.error("Breach notification send failed", {
          breachId: breach.id,
          userId: breach.user_id,
          attemptCount,
          terminalFailure,
          error: message,
        });
        continue;
      }

      const notifyResponse = await supabase
        .from("limit_breach_events")
        .update({ notified_at: toIso(new Date()) })
        .eq("id", breach.id);

      if (notifyResponse.error) {
        throw new Error(`Failed to mark breach as notified: ${notifyResponse.error.message}`);
      }

      stats.sent++;
    } catch (error) {
      stats.errors++;
      errors.push({
        userId: breach.user_id,
        breachId: breach.id,
        code: "BREACH_NOTIFICATION_FAILED",
        message: error instanceof Error ? error.message : "Unknown breach notification error.",
      });
      console.error("Breach notification failed", { breachId: breach.id, userId: breach.user_id, error });
    }
  }

  return {
    job: "send-notifications",
    startedAt,
    finishedAt: toIso(new Date()),
    stats,
    errors,
  };
};
