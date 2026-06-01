import type { SupabaseClient } from "@supabase/supabase-js";
import { toIso } from "@/lib/services/consumption-window";
import { createTuyaClient, syncMeterReading } from "@/lib/services/tuya-client";
import { getMissingTuyaConfigKeys, getTuyaConfig } from "@/lib/services/tuya-config";
import { TuyaServiceError } from "@/lib/services/tuya-errors";

export interface CronSyncJobResult {
  job: "sync-readings";
  startedAt: string;
  finishedAt: string;
  stats: { processed: number; skipped: number; breached: number; errors: number };
  errors: { userId?: string; limitId?: string; code: string; message: string }[];
}

interface EligibleSyncTarget {
  userId: string;
  meterId: string;
}

const emptyStats = () => ({ processed: 0, skipped: 0, breached: 0, errors: 0 });

const loadEligibleSyncTargets = async (supabase: SupabaseClient): Promise<EligibleSyncTarget[]> => {
  const [metersResponse, tokensResponse] = await Promise.all([
    supabase.from("meters").select("id, user_id"),
    supabase.from("tuya_oauth_tokens").select("user_id"),
  ]);

  if (metersResponse.error) {
    throw new Error(`Failed to load meters: ${metersResponse.error.message}`);
  }

  if (tokensResponse.error) {
    throw new Error(`Failed to load Tuya OAuth tokens: ${tokensResponse.error.message}`);
  }

  const linkedUserIds = new Set((tokensResponse.data as { user_id: string }[]).map((row) => row.user_id));

  return (metersResponse.data as { id: string; user_id: string }[])
    .filter((meter) => linkedUserIds.has(meter.user_id))
    .map((meter) => ({ userId: meter.user_id, meterId: meter.id }));
};

export const runBatchTuyaSync = async (supabase: SupabaseClient): Promise<CronSyncJobResult> => {
  const startedAt = toIso(new Date());
  const stats = emptyStats();
  const errors: CronSyncJobResult["errors"] = [];

  const missingConfig = getMissingTuyaConfigKeys();
  if (missingConfig.length > 0) {
    throw new TuyaServiceError("TUYA_CONFIG_MISSING", "Missing required Tuya configuration.", 500, {
      missing: missingConfig,
    });
  }

  const config = getTuyaConfig();
  if (!config) {
    throw new TuyaServiceError("TUYA_CONFIG_MISSING", "Missing required Tuya configuration.", 500);
  }

  const targets = await loadEligibleSyncTargets(supabase);
  const client = await createTuyaClient(config);

  for (const target of targets) {
    try {
      await syncMeterReading(supabase, client, target.userId, { meterId: target.meterId });
      stats.processed++;
    } catch (error) {
      stats.errors++;
      errors.push({
        userId: target.userId,
        code: error instanceof TuyaServiceError ? error.code : "SYNC_READINGS_FAILED",
        message: error instanceof Error ? error.message : "Unknown sync readings error.",
      });
      console.error("Batch Tuya sync failed", { userId: target.userId, meterId: target.meterId, error });
    }
  }

  return {
    job: "sync-readings",
    startedAt,
    finishedAt: toIso(new Date()),
    stats,
    errors,
  };
};
