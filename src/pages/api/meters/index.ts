import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { getUserMeter, upsertUserMeter } from "@/lib/services/meter-service";
import { tuyaErrorResponse, tuyaJsonError, tuyaJsonSuccess } from "@/lib/services/tuya-api-response";
import { assertMeterDeviceAllowed, createTuyaClient } from "@/lib/services/tuya-client";
import { getMissingTuyaConfigKeys, getTuyaConfig } from "@/lib/services/tuya-config";

export const prerender = false;

const meterUpsertSchema = z
  .object({
    label: z.string().trim().min(1, "Meter label is required"),
    tuya_device_id: z.string().trim().min(1, "Tuya device ID is required"),
    tuya_product_id: z.string().trim().min(1).optional(),
  })
  .strict();

export const GET: APIRoute = async ({ request, locals, cookies }) => {
  if (!locals.user) {
    return tuyaJsonError(401, "UNAUTHORIZED", "User session is required for meter lookup.");
  }

  const supabase = createClient(request.headers, cookies);
  if (!supabase) {
    return tuyaJsonError(500, "SUPABASE_NOT_CONFIGURED", "Supabase is not configured.");
  }

  try {
    const meter = await getUserMeter(supabase, locals.user.id);
    return tuyaJsonSuccess(200, { meter });
  } catch (error) {
    return tuyaErrorResponse(error);
  }
};

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  if (!locals.user) {
    return tuyaJsonError(401, "UNAUTHORIZED", "User session is required for meter registration.");
  }

  const supabase = createClient(request.headers, cookies);
  if (!supabase) {
    return tuyaJsonError(500, "SUPABASE_NOT_CONFIGURED", "Supabase is not configured.");
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return tuyaJsonError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  const parsedPayload = meterUpsertSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return tuyaJsonError(400, "VALIDATION_ERROR", "Invalid meter payload.", {
      issues: parsedPayload.error.issues,
    });
  }

  try {
    const missingConfig = getMissingTuyaConfigKeys();
    if (missingConfig.length === 0) {
      const config = getTuyaConfig();
      if (config) {
        const client = await createTuyaClient(config);
        await assertMeterDeviceAllowed(supabase, client, locals.user.id, parsedPayload.data.tuya_device_id);
      }
    }

    const meter = await upsertUserMeter(supabase, locals.user.id, parsedPayload.data);
    return tuyaJsonSuccess(200, { meter });
  } catch (error) {
    return tuyaErrorResponse(error);
  }
};
