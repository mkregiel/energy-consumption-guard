import type { APIRoute } from "astro";
import { z } from "zod";

export const prerender = false;

const syncPayloadSchema = z
  .object({
    meterId: z.uuid().optional(),
    forceRefresh: z.boolean().optional(),
  })
  .strict();

const jsonError = (status: number, code: string, message: string, details?: unknown) =>
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

const jsonSuccess = (status: number, data: Record<string, unknown>) =>
  Response.json(
    {
      ok: true,
      data,
    },
    { status },
  );

const getMissingTuyaConfig = (): string[] => {
  const required = ["TUYA_CLIENT_ID", "TUYA_CLIENT_SECRET", "TUYA_API_BASE_URL", "TUYA_API_REGION"] as const;
  return required.filter((key) => !import.meta.env[key]);
};

export const POST: APIRoute = async ({ request, locals }) => {
  if (!locals.user) {
    return jsonError(401, "UNAUTHORIZED", "User session is required for Tuya sync.");
  }

  const missingConfig = getMissingTuyaConfig();
  if (missingConfig.length > 0) {
    return jsonError(500, "TUYA_CONFIG_MISSING", "Missing required Tuya configuration.", {
      missing: missingConfig,
    });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  const parsedPayload = syncPayloadSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return jsonError(400, "VALIDATION_ERROR", "Invalid Tuya sync payload.", {
      issues: parsedPayload.error.issues,
    });
  }

  return jsonSuccess(202, {
    status: "accepted",
    synced: false,
    meterId: parsedPayload.data.meterId ?? null,
    forceRefresh: parsedPayload.data.forceRefresh ?? false,
    message: "Tuya sync contract validated. Provider synchronization is implemented in phase 3.",
  });
};
