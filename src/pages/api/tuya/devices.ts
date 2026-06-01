import type { APIRoute } from "astro";
import { requireUser } from "@/lib/auth-guard";
import { createClient } from "@/lib/supabase";
import { apiJsonError, apiJsonSuccess } from "@/lib/services/api-response";
import { tuyaErrorResponse } from "@/lib/services/tuya-api-response";
import { createTuyaClient, listLinkedUserDevices } from "@/lib/services/tuya-client";
import { getMissingTuyaConfigKeys, getTuyaConfig } from "@/lib/services/tuya-config";

export const prerender = false;

export const GET: APIRoute = async ({ request, locals, cookies }) => {
  const userOrResponse = requireUser(locals);
  if (userOrResponse instanceof Response) {
    return userOrResponse;
  }

  const missingConfig = getMissingTuyaConfigKeys();
  if (missingConfig.length > 0) {
    return apiJsonError(500, "TUYA_CONFIG_MISSING", "Missing required Tuya configuration.", {
      missing: missingConfig,
    });
  }

  const supabase = createClient(request.headers, cookies);
  if (!supabase) {
    return apiJsonError(500, "SUPABASE_NOT_CONFIGURED", "Supabase is not configured.");
  }

  const config = getTuyaConfig();
  if (!config) {
    return apiJsonError(500, "TUYA_CONFIG_MISSING", "Missing required Tuya configuration.");
  }

  try {
    const client = await createTuyaClient(config);
    const devices = await listLinkedUserDevices(supabase, client, userOrResponse.id);

    return apiJsonSuccess(200, { devices });
  } catch (error) {
    return tuyaErrorResponse(error);
  }
};
