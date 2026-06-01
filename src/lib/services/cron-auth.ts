import { timingSafeEqual } from "node:crypto";
import { CRON_SECRET } from "astro:env/server";
import { cronJsonError } from "@/lib/services/cron-api-response";

const safeEqualSecret = (provided: string, secret: string): boolean => {
  const providedBuffer = Buffer.from(provided);
  const secretBuffer = Buffer.from(secret);

  if (providedBuffer.length !== secretBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, secretBuffer);
};

export function assertCronAuthorized(request: Request): Response | null {
  if (!CRON_SECRET) {
    return cronJsonError(500, "CRON_NOT_CONFIGURED", "CRON_SECRET is not configured.");
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return cronJsonError(401, "CRON_UNAUTHORIZED", "Missing or invalid Authorization header.");
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!safeEqualSecret(token, CRON_SECRET)) {
    return cronJsonError(401, "CRON_UNAUTHORIZED", "Invalid cron authorization token.");
  }

  return null;
}
