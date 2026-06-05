import type { SupabaseClient } from "@supabase/supabase-js";
import { getWindowBounds, toIso } from "@/lib/services/consumption-window";
import type { ConsumptionLimit, Meter } from "@/types";

export interface LimitEvaluationJobResult {
  job: "evaluate-limits";
  startedAt: string;
  finishedAt: string;
  stats: { processed: number; skipped: number; breached: number; errors: number };
  errors: { userId?: string; limitId?: string; code: string; message: string }[];
}

const emptyStats = () => ({ processed: 0, skipped: 0, breached: 0, errors: 0 });

const loadMetersByUserId = async (supabase: SupabaseClient, userIds: string[]): Promise<Map<string, Meter>> => {
  if (userIds.length === 0) {
    return new Map();
  }

  const response = await supabase.from("meters").select("*").in("user_id", userIds);

  if (response.error) {
    throw new Error(`Failed to load meters: ${response.error.message}`);
  }

  return new Map((response.data as Meter[]).map((meter) => [meter.user_id, meter]));
};

export const runLimitEvaluation = async (supabase: SupabaseClient): Promise<LimitEvaluationJobResult> => {
  const startedAt = toIso(new Date());
  const stats = emptyStats();
  const errors: LimitEvaluationJobResult["errors"] = [];

  const limitsResponse = await supabase.from("consumption_limits").select("*");

  if (limitsResponse.error) {
    throw new Error(`Failed to load consumption limits: ${limitsResponse.error.message}`);
  }

  const limits = limitsResponse.data as ConsumptionLimit[];
  const metersByUserId = await loadMetersByUserId(
    supabase,
    limits.map((limit) => limit.user_id),
  );

  for (const limit of limits) {
    try {
      const outcome = await evaluateLimit(supabase, limit, metersByUserId.get(limit.user_id) ?? null);
      stats.processed++;

      if (outcome === "skipped") {
        stats.skipped++;
      } else {
        stats.breached++;
      }
    } catch (error) {
      stats.errors++;
      errors.push({
        userId: limit.user_id,
        limitId: limit.id,
        code: "LIMIT_EVALUATION_FAILED",
        message: error instanceof Error ? error.message : "Unknown limit evaluation error.",
      });
      console.error("Limit evaluation failed", { userId: limit.user_id, limitId: limit.id, error });
    }
  }

  return {
    job: "evaluate-limits",
    startedAt,
    finishedAt: toIso(new Date()),
    stats,
    errors,
  };
};

const evaluateLimit = async (
  supabase: SupabaseClient,
  limit: ConsumptionLimit,
  meter: Meter | null,
): Promise<"skipped" | "breached"> => {
  if (!meter) {
    return "skipped";
  }

  const { windowStart, windowEnd } = getWindowBounds(limit.window_type, limit.timezone);
  const windowStartIso = toIso(windowStart);
  const windowEndIso = toIso(windowEnd);

  const sumResponse = await supabase.rpc("sum_meter_consumption_in_window", {
    p_meter_id: meter.id,
    p_window_start: windowStartIso,
    p_window_end: windowEndIso,
  });

  if (sumResponse.error) {
    throw new Error(`Failed to sum consumption readings: ${sumResponse.error.message}`);
  }

  const consumptionKwh = Number(sumResponse.data ?? 0);

  const readingsExistResponse = await supabase
    .from("consumption_readings")
    .select("id")
    .eq("meter_id", meter.id)
    .gte("recorded_at", windowStartIso)
    .lt("recorded_at", windowEndIso)
    .limit(1)
    .maybeSingle();

  if (readingsExistResponse.error) {
    throw new Error(`Failed to check consumption readings: ${readingsExistResponse.error.message}`);
  }

  if (!readingsExistResponse.data) {
    return "skipped";
  }

  if (consumptionKwh <= limit.threshold_kwh) {
    return "skipped";
  }

  const existingBreachResponse = await supabase
    .from("limit_breach_events")
    .select("id")
    .eq("limit_id", limit.id)
    .eq("window_start", windowStartIso)
    .limit(1)
    .maybeSingle();

  if (existingBreachResponse.error) {
    throw new Error(`Failed to check existing breach events: ${existingBreachResponse.error.message}`);
  }

  if (existingBreachResponse.data) {
    return "skipped";
  }

  // Plain insert — the existingBreachResponse check above already guards against duplicates.
  // PostgREST cannot use the partial unique index on (limit_id, window_start) for ON CONFLICT.
  const insertResponse = await supabase
    .from("limit_breach_events")
    .insert({
      limit_id: limit.id,
      user_id: limit.user_id,
      breached_at: toIso(new Date()),
      window_start: windowStartIso,
      consumption_kwh: consumptionKwh,
      notified_at: null,
    })
    .select("id")
    .maybeSingle();

  if (insertResponse.error) {
    throw new Error(`Failed to insert breach event: ${insertResponse.error.message}`);
  }

  if (!insertResponse.data) {
    return "skipped";
  }

  return "breached";
};
