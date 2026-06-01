import { TuyaServiceError } from "@/lib/services/tuya-errors";
import { apiJsonError, apiJsonSuccess } from "@/lib/services/api-response";

export { apiJsonError as tuyaJsonError, apiJsonSuccess as tuyaJsonSuccess };

export const tuyaErrorResponse = (error: unknown) => {
  if (error instanceof TuyaServiceError) {
    return apiJsonError(error.httpStatus, error.code, error.message, error.details);
  }

  return apiJsonError(500, "TUYA_PROVIDER_ERROR", "Unexpected Tuya integration error.");
};
