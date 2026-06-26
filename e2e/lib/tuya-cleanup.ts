import { createClient } from "@supabase/supabase-js";
import { loadTestEnv } from "../load-test-env";

/**
 * Deletes the tuya_oauth_tokens row for the e2e test user, so re-running
 * e2e/tuya-oauth-connect.spec.ts is idempotent.
 */
export async function deleteTuyaOAuthTokenForTestUser(): Promise<void> {
  loadTestEnv();

  // The Playwright webServer runs the dev server against the LOCAL Supabase
  // instance (.env's SUPABASE_URL), not the cloud project in .env.test — so
  // cleanup must target the same local instance the dev server writes to.
  // SUPABASE_LOCAL_URL/SUPABASE_LOCAL_SERVICE_ROLE_KEY are local-only secrets
  // from `npx supabase status`, set in .env.test (gitignored).
  const supabaseUrl = process.env.SUPABASE_LOCAL_URL;
  const serviceRoleKey = process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY;
  const testUserEmail = process.env.E2E_TEST_USER_EMAIL;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_LOCAL_URL and SUPABASE_LOCAL_SERVICE_ROLE_KEY must be set in .env.test for tuya-cleanup");
  }
  if (!testUserEmail) {
    throw new Error("E2E_TEST_USER_EMAIL must be set in .env.test for tuya-cleanup");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // GoTrue's admin listUsers has no email-filter param, only pagination —
  // cap perPage so this stays bounded as the local test DB grows.
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 200 });
  if (error) throw new Error(`Failed to list users: ${error.message}`);

  const user = data.users.find((candidate) => candidate.email === testUserEmail);
  if (!user) {
    throw new Error(`E2E test user not found: ${testUserEmail}`);
  }

  const { error: meterDeleteError } = await supabase.from("meters").delete().eq("user_id", user.id);
  if (meterDeleteError) throw new Error(`Failed to delete meters: ${meterDeleteError.message}`);

  const { error: deleteError } = await supabase.from("tuya_oauth_tokens").delete().eq("user_id", user.id);
  if (deleteError) throw new Error(`Failed to delete tuya_oauth_tokens: ${deleteError.message}`);
}
