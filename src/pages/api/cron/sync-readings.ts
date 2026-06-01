import type { APIRoute } from "astro";
import { assertCronAuthorized } from "@/lib/services/cron-auth";
import { cronJsonError, cronJsonSuccess } from "@/lib/services/cron-api-response";
import { runBatchTuyaSync } from "@/lib/services/cron-sync";
import { TuyaServiceError } from "@/lib/services/tuya-errors";
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
    const result = await runBatchTuyaSync(supabase);
    return cronJsonSuccess(200, result);
  } catch (error) {
    console.error("Sync readings cron job failed", error);

    if (error instanceof TuyaServiceError) {
      return cronJsonError(error.httpStatus, error.code, error.message, error.details);
    }

    return cronJsonError(
      500,
      "CRON_JOB_FAILED",
      error instanceof Error ? error.message : "Unexpected sync-readings cron failure.",
    );
  }
};
