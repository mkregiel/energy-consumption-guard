import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";
import { tuyaErrorResponse, tuyaJsonError, tuyaJsonSuccess } from "@/lib/services/tuya-api-response";
import { createTuyaClient, listLinkedUserDevices } from "@/lib/services/tuya-client";
import { getMissingTuyaConfigKeys, getTuyaConfig } from "@/lib/services/tuya-config";

export const prerender = false;

export const GET: APIRoute = async ({ request, locals, cookies }) => {
  if (!locals.user) {
    return tuyaJsonError(401, "UNAUTHORIZED", "User session is required for Tuya device list.");
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

  const config = getTuyaConfig();
  if (!config) {
    return tuyaJsonError(500, "TUYA_CONFIG_MISSING", "Missing required Tuya configuration.");
  }

  try {
    const client = await createTuyaClient(config);
    const devices = await listLinkedUserDevices(supabase, client, locals.user.id);

    return tuyaJsonSuccess(200, { devices });
  } catch (error) {
    return tuyaErrorResponse(error);
  }
};
