import { TuyaServiceError } from "@/lib/services/tuya-errors";

export const tuyaJsonError = (status: number, code: string, message: string, details?: unknown) =>
  Response.json(
    {
      ok: false,
      error: {
        code,
        message,
        details,
      },
    },
    { status },
  );

export const tuyaJsonSuccess = (status: number, data: Record<string, unknown>) =>
  Response.json(
    {
      ok: true,
      data,
    },
    { status },
  );

export const tuyaErrorResponse = (error: unknown) => {
  if (error instanceof TuyaServiceError) {
    return tuyaJsonError(error.httpStatus, error.code, error.message, error.details);
  }

  return tuyaJsonError(500, "TUYA_PROVIDER_ERROR", "Unexpected Tuya integration error.");
};
