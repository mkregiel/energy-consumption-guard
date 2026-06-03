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
const MARK_NOTIFIED_RETRIES = 3;
const MARK_NOTIFIED_RETRY_DELAY_MS = 100;

type BreachWithLimit = LimitBreachEvent & {
  consumption_limits: Pick<ConsumptionLimit, "threshold_kwh" | "window_type" | "timezone"> | null;
};

const emptyStats = () => ({ processed: 0, sent: 0, skipped: 0, failed: 0, errors: 0 });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const loadNotificationSettingsByUserId = async (
  supabase: SupabaseClient,
  userIds: string[],
): Promise<Map<string, NotificationSettings>> => {
  if (userIds.length === 0) {
    return new Map();
  }

  const response = await supabase.from("notification_settings").select("*").in("user_id", userIds);

  if (response.error) {
    throw new Error(`Failed to load notification settings: ${response.error.message}`);
  }

  return new Map((response.data as NotificationSettings[]).map((settings) => [settings.user_id, settings]));
};

const recordNotificationAttemptFailure = async (
  supabase: SupabaseClient,
  breach: LimitBreachEvent,
  code: string,
  message: string,
  errors: BreachNotificationJobResult["errors"],
  stats: ReturnType<typeof emptyStats>,
): Promise<void> => {
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
  errors.push({
    userId: breach.user_id,
    breachId: breach.id,
    code: terminalFailure ? "NOTIFICATION_FAILED_TERMINAL" : code,
    message,
  });
  console.error("Breach notification attempt failed", {
    breachId: breach.id,
    userId: breach.user_id,
    attemptCount,
    terminalFailure,
    code,
    error: message,
  });
};

const markBreachNotified = async (
  supabase: SupabaseClient,
  breachId: string,
): Promise<{ ok: true } | { ok: false; message: string }> => {
  const nowIso = toIso(new Date());
  let lastError = "Failed to mark breach as notified.";

  for (let attempt = 1; attempt <= MARK_NOTIFIED_RETRIES; attempt++) {
    const response = await supabase
      .from("limit_breach_events")
      .update({ notified_at: nowIso })
      .eq("id", breachId)
      .is("notified_at", null)
      .select("id")
      .maybeSingle();

    if (response.error) {
      lastError = response.error.message;
      if (attempt < MARK_NOTIFIED_RETRIES) {
        await sleep(MARK_NOTIFIED_RETRY_DELAY_MS * attempt);
        continue;
      }
      return { ok: false, message: lastError };
    }

    if (response.data) {
      return { ok: true };
    }

    return { ok: true };
  }

  return { ok: false, message: lastError };
};

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
  const settingsByUserId = await loadNotificationSettingsByUserId(supabase, [
    ...new Set(breaches.map((breach) => breach.user_id)),
  ]);

  for (const breach of breaches) {
    stats.processed++;

    try {
      const settings = settingsByUserId.get(breach.user_id) ?? null;

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
        const message = sendError instanceof Error ? sendError.message : "Unknown Resend send error.";
        await recordNotificationAttemptFailure(supabase, breach, "NOTIFICATION_SEND_FAILED", message, errors, stats);
        continue;
      }

      const markResult = await markBreachNotified(supabase, breach.id);
      if (!markResult.ok) {
        await recordNotificationAttemptFailure(
          supabase,
          breach,
          "NOTIFICATION_MARK_FAILED",
          markResult.message,
          errors,
          stats,
        );
        continue;
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
