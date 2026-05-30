import type { APIRoute } from "astro";
import {
  buildTuyaOAuthAuthorizeUrl,
  getMissingTuyaConfigKeys,
  getTuyaConfig,
  getTuyaOAuthRedirectUri,
} from "@/lib/services/tuya-config";
import { tuyaJsonError } from "@/lib/services/tuya-api-response";

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
  if (!locals.user) {
    const returnTo = encodeURIComponent("/api/tuya/oauth/start");
    return redirect(`/auth/signin?returnTo=${returnTo}`);
  }

  const missingConfig = getMissingTuyaConfigKeys();
  if (missingConfig.length > 0) {
    return tuyaJsonError(500, "TUYA_CONFIG_MISSING", "Missing required Tuya configuration.", {
      missing: missingConfig,
    });
  }

  const config = getTuyaConfig();
  if (!config) {
    return tuyaJsonError(500, "TUYA_CONFIG_MISSING", "Missing required Tuya configuration.");
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
