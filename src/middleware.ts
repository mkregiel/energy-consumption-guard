import { defineMiddleware } from "astro:middleware";
import { unauthorizedResponse } from "@/lib/auth-guard";
import { createClient } from "@/lib/supabase";

const PROTECTED_ROUTES = ["/dashboard"];
const PUBLIC_API_PREFIXES = ["/api/auth/", "/api/cron/"];

const isPublicApiRoute = (pathname: string): boolean =>
  PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);

  if (supabase) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    context.locals.user = user ?? null;
  } else {
    context.locals.user = null;
  }

  const { pathname } = context.url;

  if (PROTECTED_ROUTES.some((route) => pathname.startsWith(route))) {
    if (!context.locals.user) {
      return context.redirect("/auth/signin");
    }
  }

  if (pathname.startsWith("/api/") && !isPublicApiRoute(pathname) && !context.locals.user) {
    return unauthorizedResponse();
  }

  return next();
});
