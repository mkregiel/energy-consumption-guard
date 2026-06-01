import type { APIRoute } from "astro";
import { assertCronAuthorized } from "@/lib/services/cron-auth";
import { cronJsonError, cronJsonSuccess } from "@/lib/services/cron-api-response";
import { runLimitEvaluation } from "@/lib/services/limit-evaluation";
import { createServiceRoleClient } from "@/lib/supabase-service-role";

export const prerender = false;

const methodNotAllowed = () => cronJsonError(405, "METHOD_NOT_ALLOWED", "Only POST is supported.");

export const GET: APIRoute = methodNotAllowed;
export const PUT: APIRoute = methodNotAllowed;
export const PATCH: APIRoute = methodNotAllowed;
export const DELETE: APIRoute = methodNotAllowed;

export const POST: APIRoute = async ({ request }) => {
  const authError = assertCronAuthorized(request);
  if (authError) {
    return authError;
  }

  const supabase = createServiceRoleClient();
  if (!supabase) {
    return cronJsonError(500, "CRON_NOT_CONFIGURED", "Service role Supabase client is not configured.");
  }

  try {
    const result = await runLimitEvaluation(supabase);
    return cronJsonSuccess(200, result);
  } catch (error) {
    console.error("Evaluate limits cron job failed", error);
    return cronJsonError(
      500,
      "CRON_JOB_FAILED",
      error instanceof Error ? error.message : "Unexpected evaluate-limits cron failure.",
    );
  }
};
