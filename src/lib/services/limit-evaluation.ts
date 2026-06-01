import type { SupabaseClient } from "@supabase/supabase-js";
import { getWindowBounds, toIso } from "@/lib/services/consumption-window";
import { getUserMeter } from "@/lib/services/meter-service";
import type { ConsumptionLimit, ConsumptionReading } from "@/types";

export interface LimitEvaluationJobResult {
  job: "evaluate-limits";
  startedAt: string;
  finishedAt: string;
  stats: { processed: number; skipped: number; breached: number; errors: number };
  errors: { userId?: string; limitId?: string; code: string; message: string }[];
}

const emptyStats = () => ({ processed: 0, skipped: 0, breached: 0, errors: 0 });

export const runLimitEvaluation = async (supabase: SupabaseClient): Promise<LimitEvaluationJobResult> => {
  const startedAt = toIso(new Date());
  const stats = emptyStats();
  const errors: LimitEvaluationJobResult["errors"] = [];

  const limitsResponse = await supabase.from("consumption_limits").select("*");

  if (limitsResponse.error) {
    throw new Error(`Failed to load consumption limits: ${limitsResponse.error.message}`);
  }

  const limits = limitsResponse.data as ConsumptionLimit[];

  for (const limit of limits) {
    try {
      const outcome = await evaluateLimit(supabase, limit);
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

const evaluateLimit = async (supabase: SupabaseClient, limit: ConsumptionLimit): Promise<"skipped" | "breached"> => {
  const meter = await getUserMeter(supabase, limit.user_id);
  if (!meter) {
    return "skipped";
  }

  const { windowStart, windowEnd } = getWindowBounds(limit.window_type, limit.timezone);
  const windowStartIso = toIso(windowStart);
  const windowEndIso = toIso(windowEnd);

  const readingsResponse = await supabase
    .from("consumption_readings")
    .select("kwh_delta")
    .eq("meter_id", meter.id)
    .gte("recorded_at", windowStartIso)
    .lt("recorded_at", windowEndIso);

  if (readingsResponse.error) {
    throw new Error(`Failed to load consumption readings: ${readingsResponse.error.message}`);
  }

  const readings = readingsResponse.data as Pick<ConsumptionReading, "kwh_delta">[];
  if (readings.length === 0) {
    return "skipped";
  }

  const consumptionKwh = readings.reduce((sum, row) => sum + (row.kwh_delta ?? 0), 0);

  if (consumptionKwh <= limit.threshold_kwh) {
    return "skipped";
  }

  const existingBreachResponse = await supabase
    .from("limit_breach_events")
    .select("id")
    .eq("limit_id", limit.id)
    .gte("breached_at", windowStartIso)
    .limit(1)
    .maybeSingle();

  if (existingBreachResponse.error) {
    throw new Error(`Failed to check existing breach events: ${existingBreachResponse.error.message}`);
  }

  if (existingBreachResponse.data) {
    return "skipped";
  }

  const insertResponse = await supabase.from("limit_breach_events").insert({
    limit_id: limit.id,
    user_id: limit.user_id,
    breached_at: toIso(new Date()),
    consumption_kwh: consumptionKwh,
    notified_at: null,
  });

  if (insertResponse.error) {
    throw new Error(`Failed to insert breach event: ${insertResponse.error.message}`);
  }

  return "breached";
};
