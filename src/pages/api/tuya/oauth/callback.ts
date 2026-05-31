import type { APIRoute } from "astro";
import { z } from "zod";
import { createClient } from "@/lib/supabase";
import { tuyaErrorResponse, tuyaJsonError, tuyaJsonSuccess } from "@/lib/services/tuya-api-response";
import { createTuyaClient, linkTuyaAccount } from "@/lib/services/tuya-client";
import { getMissingTuyaConfigKeys, getTuyaConfig } from "@/lib/services/tuya-config";

export const prerender = false;

const callbackPayloadSchema = z.object({
  code: z.string().min(1, "Missing authorization code"),
  state: z.string().min(1, "Missing OAuth state"),
});

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  if (!locals.user) {
    return tuyaJsonError(401, "UNAUTHORIZED", "User session is required for Tuya OAuth callback.");
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

  const parsedPayload = callbackPayloadSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return tuyaJsonError(400, "VALIDATION_ERROR", "Invalid OAuth callback payload.", {
      issues: parsedPayload.error.issues,
    });
  }

  const expectedState = cookies.get("tuya_oauth_state")?.value;
  if (!expectedState) {
    return tuyaJsonError(
      400,
      "TUYA_STATE_MISMATCH",
      "OAuth state cookie is missing or expired. Restart the linking flow.",
    );
  }
  if (expectedState !== parsedPayload.data.state) {
    return tuyaJsonError(400, "TUYA_STATE_MISMATCH", "OAuth state does not match the active session.");
  }

  const config = getTuyaConfig();
  if (!config) {
    return tuyaJsonError(500, "TUYA_CONFIG_MISSING", "Missing required Tuya configuration.");
  }

  try {
    const client = await createTuyaClient(config);
    const linked = await linkTuyaAccount(supabase, client, locals.user.id, parsedPayload.data.code);

    cookies.delete("tuya_oauth_state", { path: "/" });

    return tuyaJsonSuccess(200, {
      linked: linked.linked,
      status: "linked",
      tuyaUid: linked.tuyaUid,
      accessTokenExpiresAt: linked.accessTokenExpiresAt,
      transportMode: client.transportMode,
      message: "Tuya account linked successfully.",
    });
  } catch (error) {
    return tuyaErrorResponse(error);
  }
};
