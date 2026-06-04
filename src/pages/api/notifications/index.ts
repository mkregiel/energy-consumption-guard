import type { APIRoute } from "astro";
import { z } from "zod";
import { requireUser } from "@/lib/auth-guard";
import { createClient } from "@/lib/supabase";
import { getUserNotificationSettings, upsertNotificationSettings } from "@/lib/services/notification-settings-service";
import { apiJsonError, apiJsonSuccess } from "@/lib/services/api-response";
import { tuyaErrorResponse } from "@/lib/services/tuya-api-response";

export const prerender = false;

const notificationSettingsUpsertSchema = z
  .object({
    alarm_email: z.email(),
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
    const settings = await getUserNotificationSettings(supabase, userOrResponse.id);
    return apiJsonSuccess(200, { settings });
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

  const parsed = notificationSettingsUpsertSchema.safeParse(payload);
  if (!parsed.success) {
    return apiJsonError(400, "VALIDATION_ERROR", "Invalid notification settings payload.", {
      issues: parsed.error.issues,
    });
  }

  try {
    const settings = await upsertNotificationSettings(supabase, userOrResponse.id, parsed.data.alarm_email);
    return apiJsonSuccess(200, { settings });
  } catch (error) {
    return tuyaErrorResponse(error);
  }
};
