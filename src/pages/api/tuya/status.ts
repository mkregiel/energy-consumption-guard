import type { APIRoute } from "astro";
import { requireUser } from "@/lib/auth-guard";
import { createClient } from "@/lib/supabase";
import { apiJsonError, apiJsonSuccess } from "@/lib/services/api-response";
import { tuyaErrorResponse } from "@/lib/services/tuya-api-response";
import { getTuyaConnectionStatus } from "@/lib/services/tuya-client";

export const prerender = false;

export const GET: APIRoute = async ({ request, locals, cookies }) => {
  const userOrResponse = requireUser(locals);
  if (userOrResponse instanceof Response) {
    return userOrResponse;
  }

  const supabase = createClient(request.headers, cookies);
  if (!supabase) {
    return apiJsonError(500, "SUPABASE_NOT_CONFIGURED", "Supabase is not configured.");
  }

  try {
    const status = await getTuyaConnectionStatus(supabase, userOrResponse.id);
    return apiJsonSuccess(200, status);
  } catch (error) {
    return tuyaErrorResponse(error);
  }
};
