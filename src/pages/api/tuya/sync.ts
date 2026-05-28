import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { tuyaErrorResponse, tuyaJsonError, tuyaJsonSuccess } from "@/lib/services/tuya-api-response";
import { createTuyaClient, syncMeterReading } from "@/lib/services/tuya-client";
import { getMissingTuyaConfigKeys, getTuyaConfig } from "@/lib/services/tuya-config";

export const prerender = false;

const syncPayloadSchema = z
  .object({
    meterId: z.uuid().optional(),
    forceRefresh: z.boolean().optional(),
  })
  .strict();

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  if (!locals.user) {
    return tuyaJsonError(401, "UNAUTHORIZED", "User session is required for Tuya sync.");
  }

  const missingConfig = getMissingTuyaConfigKeys();
  if (missingConfig.length > 0) {
    return tuyaJsonError(500, "TUYA_CONFIG_MISSING", "Missing required Tuya configuration.", {
      missing: missingConfig,
    });
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

  const parsedPayload = syncPayloadSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return tuyaJsonError(400, "VALIDATION_ERROR", "Invalid Tuya sync payload.", {
      issues: parsedPayload.error.issues,
    });
  }

  const config = getTuyaConfig();
  if (!config) {
    return tuyaJsonError(500, "TUYA_CONFIG_MISSING", "Missing required Tuya configuration.");
  }

  try {
    const client = await createTuyaClient(config);
    const result = await syncMeterReading(supabase, client, locals.user.id, parsedPayload.data);

    return tuyaJsonSuccess(200, {
      status: "synced",
      synced: true,
      meterId: result.meter.id,
      forceRefresh: parsedPayload.data.forceRefresh ?? false,
      transportMode: result.transportMode,
      reading: result.reading,
      message: "Consumption reading synchronized from Tuya.",
    });
  } catch (error) {
    return tuyaErrorResponse(error);
  }
};
