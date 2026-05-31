import type { APIRoute } from "astro";
import { sanitizeReturnTo } from "@/lib/auth-redirect";
import { createClient } from "@/lib/supabase";

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const email = form.get("email") as string;
  const password = form.get("password") as string;
  const returnTo = sanitizeReturnTo(form.get("returnTo"));

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect(`/auth/signin?error=${encodeURIComponent("Supabase is not configured")}`);
  }
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    const errorQuery = new URLSearchParams({ error: error.message });
    if (returnTo) {
      errorQuery.set("returnTo", returnTo);
    }
    return context.redirect(`/auth/signin?${errorQuery.toString()}`);
  }

  return context.redirect(returnTo ?? "/");
};
