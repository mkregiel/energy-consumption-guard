import type { APIRoute } from "astro";
import { z } from "zod";
import { requireUser } from "@/lib/auth-guard";
import { createClient } from "@/lib/supabase";
import { getUserLimit, upsertUserLimit } from "@/lib/services/limit-service";
import { apiJsonError, apiJsonSuccess } from "@/lib/services/api-response";
import { tuyaErrorResponse } from "@/lib/services/tuya-api-response";

export const prerender = false;

const limitUpsertSchema = z
  .object({
    threshold_kwh: z.coerce.number().positive(),
    window_type: z.enum(["day", "week", "month"]),
  })
  .strict();

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
    const limit = await getUserLimit(supabase, userOrResponse.id);
    return apiJsonSuccess(200, { limit });
  } catch (error) {
    return tuyaErrorResponse(error);
  }
};

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  const userOrResponse = requireUser(locals);
  if (userOrResponse instanceof Response) {
    return userOrResponse;
  }

  const supabase = createClient(request.headers, cookies);
  if (!supabase) {
    return apiJsonError(500, "SUPABASE_NOT_CONFIGURED", "Supabase is not configured.");
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return apiJsonError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  const parsed = limitUpsertSchema.safeParse(payload);
  if (!parsed.success) {
    return apiJsonError(400, "VALIDATION_ERROR", "Invalid limit payload.", {
      issues: parsed.error.issues,
    });
  }

  try {
    const limit = await upsertUserLimit(supabase, userOrResponse.id, parsed.data);
    return apiJsonSuccess(200, { limit });
  } catch (error) {
    return tuyaErrorResponse(error);
  }
};
