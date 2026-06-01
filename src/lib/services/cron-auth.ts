import { CRON_SECRET } from "astro:env/server";
import { cronJsonError } from "@/lib/services/cron-api-response";

export function assertCronAuthorized(request: Request): Response | null {
  if (!CRON_SECRET) {
    return cronJsonError(500, "CRON_NOT_CONFIGURED", "CRON_SECRET is not configured.");
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return cronJsonError(401, "CRON_UNAUTHORIZED", "Missing or invalid Authorization header.");
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (token !== CRON_SECRET) {
    return cronJsonError(401, "CRON_UNAUTHORIZED", "Invalid cron authorization token.");
  }

  return null;
}
