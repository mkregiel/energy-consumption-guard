import type { APIRoute } from "astro";
import { requireUserRedirect } from "@/lib/auth-guard";
import { apiJsonError } from "@/lib/services/api-response";
import {
  buildTuyaOAuthAuthorizeUrl,
  getMissingTuyaConfigKeys,
  getTuyaConfig,
  getTuyaOAuthRedirectUri,
} from "@/lib/services/tuya-config";

export const prerender = false;

const OAUTH_STATE_MAX_AGE_SECONDS = 600;

const isSecureRequest = (request: Request): boolean => {
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto) {
    return forwardedProto.split(",")[0]?.trim() === "https";
  }

  return new URL(request.url).protocol === "https:";
};

export const GET: APIRoute = ({ request, locals, cookies, redirect }) => {
  const userOrResponse = requireUserRedirect(locals, redirect, "/api/tuya/oauth/start");
  if (userOrResponse instanceof Response) {
    return userOrResponse;
  }

  const missingConfig = getMissingTuyaConfigKeys();
  if (missingConfig.length > 0) {
    return apiJsonError(500, "TUYA_CONFIG_MISSING", "Missing required Tuya configuration.", {
      missing: missingConfig,
    });
  }

  const config = getTuyaConfig();
  if (!config) {
    return apiJsonError(500, "TUYA_CONFIG_MISSING", "Missing required Tuya configuration.");
  }

  const state = crypto.randomUUID();
  const redirectUri = getTuyaOAuthRedirectUri();
  const authorizeUrl = buildTuyaOAuthAuthorizeUrl(config, redirectUri, state);

  cookies.set("tuya_oauth_state", state, {
    httpOnly: true,
    path: "/",
    maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
    sameSite: "lax",
    secure: isSecureRequest(request),
  });

  return redirect(authorizeUrl);
};
