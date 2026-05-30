import {
  TUYA_API_BASE_URL,
  TUYA_API_REGION,
  TUYA_APP_IDENTIFIER,
  TUYA_AUTH_MODE,
  TUYA_CLIENT_ID,
  TUYA_CLIENT_SECRET,
  TUYA_CLOUD_CLIENT_ID,
  TUYA_CLOUD_CLIENT_SECRET,
  TUYA_OAUTH_REDIRECT_URI,
  TUYA_OAUTH_SCOPE,
} from "astro:env/server";

const DEFAULT_LOCAL_OAUTH_REDIRECT_URI = "https://127.0.0.1:3000/dashboard/tuya/callback";
/** App Device Data Sharing H5 login page (see Tuya console OAuth config). */
const TUYA_OAUTH_H5_LOGIN_PATH = "/login/open/tuya/login/v1/index.html";
const DEFAULT_TUYA_OAUTH_SCOPE = "devicemessage";

export type TuyaAuthMode = "cloud" | "app";

export interface TuyaConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
  region: string;
  authMode: TuyaAuthMode;
  appIdentifier: string;
}

export const getMissingTuyaConfigKeys = (): string[] => {
  const missing: string[] = [];
  if (!TUYA_CLIENT_ID) missing.push("TUYA_CLIENT_ID");
  if (!TUYA_CLIENT_SECRET) missing.push("TUYA_CLIENT_SECRET");
  if (!TUYA_API_BASE_URL) missing.push("TUYA_API_BASE_URL");
  if (!TUYA_API_REGION) missing.push("TUYA_API_REGION");
  return missing;
};

export const getTuyaConfig = (): TuyaConfig | null => {
  if (!TUYA_CLIENT_ID || !TUYA_CLIENT_SECRET || !TUYA_API_BASE_URL || !TUYA_API_REGION) {
    return null;
  }

  return {
    clientId: TUYA_CLIENT_ID,
    clientSecret: TUYA_CLIENT_SECRET,
    baseUrl: TUYA_API_BASE_URL.replace(/\/$/, ""),
    region: TUYA_API_REGION,
    authMode: TUYA_AUTH_MODE === "cloud" ? "cloud" : "app",
    appIdentifier: typeof TUYA_APP_IDENTIFIER === "string" ? TUYA_APP_IDENTIFIER : "",
  };
};

/** Cloud Authorization credentials for project-scoped device reads (grant_type=1). */
export const getTuyaOAuthRedirectUri = (): string => {
  if (typeof TUYA_OAUTH_REDIRECT_URI === "string" && TUYA_OAUTH_REDIRECT_URI.trim().length > 0) {
    return TUYA_OAUTH_REDIRECT_URI.trim();
  }

  return DEFAULT_LOCAL_OAUTH_REDIRECT_URI;
};

export const getTuyaOAuthScope = (): string => {
  if (typeof TUYA_OAUTH_SCOPE === "string" && TUYA_OAUTH_SCOPE.trim().length > 0) {
    return TUYA_OAUTH_SCOPE.trim();
  }

  return DEFAULT_TUYA_OAUTH_SCOPE;
};

export const buildTuyaOAuthAuthorizeUrl = (config: TuyaConfig, redirectUri: string, state: string): string => {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    scope: getTuyaOAuthScope(),
    state,
  });

  return `${config.baseUrl}${TUYA_OAUTH_H5_LOGIN_PATH}?${params.toString()}`;
};

/** Cloud Authorization credentials for project-scoped device reads (grant_type=1). */
export const getCloudDeviceReadConfig = (): TuyaConfig | null => {
  const cloudClientId = typeof TUYA_CLOUD_CLIENT_ID === "string" ? TUYA_CLOUD_CLIENT_ID : "";
  const cloudClientSecret = typeof TUYA_CLOUD_CLIENT_SECRET === "string" ? TUYA_CLOUD_CLIENT_SECRET : "";

  if (!cloudClientId || !cloudClientSecret || !TUYA_API_BASE_URL || !TUYA_API_REGION) {
    return null;
  }

  return {
    clientId: cloudClientId,
    clientSecret: cloudClientSecret,
    baseUrl: TUYA_API_BASE_URL.replace(/\/$/, ""),
    region: TUYA_API_REGION,
    authMode: "cloud",
    appIdentifier: "",
  };
};
