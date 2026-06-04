export type TuyaErrorCode =
  | "TUYA_CONFIG_MISSING"
  | "TUYA_NOT_LINKED"
  | "TUYA_AUTH_FAILED"
  | "TUYA_TOKEN_EXPIRED"
  | "TUYA_METER_NOT_FOUND"
  | "TUYA_PROVIDER_ERROR"
  | "TUYA_READING_UNAVAILABLE"
  | "TUYA_STATE_MISMATCH"
  | "SUPABASE_NOT_CONFIGURED"
  | "LIMIT_DB_ERROR"
  | "NOTIFICATION_SETTINGS_DB_ERROR";

export class TuyaServiceError extends Error {
  readonly code: TuyaErrorCode;
  readonly httpStatus: number;
  readonly details?: unknown;

  constructor(code: TuyaErrorCode, message: string, httpStatus: number, details?: unknown) {
    super(message);
    this.name = "TuyaServiceError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}

export const mapTuyaProviderError = (
  providerCode: number | string | undefined,
  providerMessage: string | undefined,
): TuyaServiceError => {
  const codeNumber = typeof providerCode === "string" ? Number(providerCode) : providerCode;

  if (codeNumber === 1010 || codeNumber === 28841002) {
    const scopeDenied = providerMessage?.toLowerCase().includes("scope");
    const tokenInvalid = providerMessage?.toLowerCase().includes("invalid");
    return new TuyaServiceError(
      scopeDenied ? "TUYA_PROVIDER_ERROR" : tokenInvalid ? "TUYA_AUTH_FAILED" : "TUYA_TOKEN_EXPIRED",
      scopeDenied
        ? "Tuya token lacks permission for this API. Check IoT Core authorization and OAuth re-link."
        : tokenInvalid
          ? "Tuya token is invalid. Re-run OAuth linking if using user tokens."
          : "Tuya access token expired or invalid.",
      scopeDenied ? 403 : 401,
      { providerCode, providerMessage },
    );
  }

  if (codeNumber === 1004 || codeNumber === 1107 || codeNumber === 1109 || codeNumber === 28841003) {
    return new TuyaServiceError("TUYA_AUTH_FAILED", "Tuya authorization failed.", 401, {
      providerCode,
      providerMessage,
    });
  }

  return new TuyaServiceError("TUYA_PROVIDER_ERROR", providerMessage ?? "Tuya provider request failed.", 502, {
    providerCode,
    providerMessage,
  });
};
