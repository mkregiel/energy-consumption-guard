import type { APIRoute } from "astro";
import { z } from "zod";
import { requireUser } from "@/lib/auth-guard";
import { createClient } from "@/lib/supabase";
import { updateMeterStatus } from "@/lib/services/meter-service";
import { apiJsonError, apiJsonSuccess } from "@/lib/services/api-response";
import { tuyaErrorResponse } from "@/lib/services/tuya-api-response";

export const prerender = false;

const meterStatusSchema = z
  .object({
    status: z.enum(["active", "inactive"]),
  })
  .strict();

export const PATCH: APIRoute = async ({ request, locals, cookies }) => {
  const userOrResponse = requireUser(locals);
  if (userOrResponse instanceof Response) {
    return userOrResponse;
  }

  const supabase = createClient(request.headers, cookies);
  if (!supabase) {
    return apiJsonError(500, "SUPABASE_NOT_CONFIGURED", "Supabase is not configured.");
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return apiJsonError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  const parsed = meterStatusSchema.safeParse(payload);
  if (!parsed.success) {
    return apiJsonError(400, "VALIDATION_ERROR", "Invalid status payload.", {
      issues: parsed.error.issues,
    });
  }

  try {
    const meter = await updateMeterStatus(supabase, userOrResponse.id, parsed.data.status);
    return apiJsonSuccess(200, { meter });
  } catch (error) {
    return tuyaErrorResponse(error);
  }
};
