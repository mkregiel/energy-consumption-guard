import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { tuyaErrorResponse, tuyaJsonError, tuyaJsonSuccess } from "@/lib/services/tuya-api-response";
import { getTuyaConnectionStatus } from "@/lib/services/tuya-client";

export const prerender = false;

export const GET: APIRoute = async ({ request, locals, cookies }) => {
  if (!locals.user) {
    return tuyaJsonError(401, "UNAUTHORIZED", "User session is required for Tuya status.");
  }

  const supabase = createClient(request.headers, cookies);
  if (!supabase) {
    return tuyaJsonError(500, "SUPABASE_NOT_CONFIGURED", "Supabase is not configured.");
  }

  try {
    const status = await getTuyaConnectionStatus(supabase, locals.user.id);
    return tuyaJsonSuccess(200, status);
  } catch (error) {
    return tuyaErrorResponse(error);
  }
};
