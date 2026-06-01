import type { User } from "@supabase/supabase-js";
import type { APIContext } from "astro";
import { apiJsonError } from "@/lib/services/api-response";

export const UNAUTHORIZED_MESSAGE = "Authentication is required.";

export const unauthorizedResponse = () => apiJsonError(401, "UNAUTHORIZED", UNAUTHORIZED_MESSAGE);

export const requireUser = (locals: App.Locals): User | Response => {
  if (!locals.user) {
    return unauthorizedResponse();
  }

  return locals.user;
};

export const requireUserRedirect = (
  locals: App.Locals,
  redirect: APIContext["redirect"],
  returnTo: string,
): User | Response => {
  if (!locals.user) {
    return redirect(`/auth/signin?returnTo=${encodeURIComponent(returnTo)}`);
  }

  return locals.user;
};
