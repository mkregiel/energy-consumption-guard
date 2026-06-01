import type { APIRoute } from "astro";
import { z } from "zod";
import { requireUser } from "@/lib/auth-guard";
import { createClient } from "@/lib/supabase";
import { getUserMeter, upsertUserMeter } from "@/lib/services/meter-service";
import { apiJsonError, apiJsonSuccess } from "@/lib/services/api-response";
import { tuyaErrorResponse } from "@/lib/services/tuya-api-response";
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
  const userOrResponse = requireUser(locals);
  if (userOrResponse instanceof Response) {
    return userOrResponse;
  }

  const supabase = createClient(request.headers, cookies);
  if (!supabase) {
    return apiJsonError(500, "SUPABASE_NOT_CONFIGURED", "Supabase is not configured.");
  }

  try {
    const meter = await getUserMeter(supabase, userOrResponse.id);
    return apiJsonSuccess(200, { meter });
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

  const parsedPayload = meterUpsertSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return apiJsonError(400, "VALIDATION_ERROR", "Invalid meter payload.", {
      issues: parsedPayload.error.issues,
    });
  }

  try {
    const missingConfig = getMissingTuyaConfigKeys();
    if (missingConfig.length === 0) {
      const config = getTuyaConfig();
      if (config) {
        const client = await createTuyaClient(config);
        await assertMeterDeviceAllowed(supabase, client, userOrResponse.id, parsedPayload.data.tuya_device_id);
      }
    }

    const meter = await upsertUserMeter(supabase, userOrResponse.id, parsedPayload.data);
    return apiJsonSuccess(200, { meter });
  } catch (error) {
    return tuyaErrorResponse(error);
  }
};
