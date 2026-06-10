import { createClient } from "@supabase/supabase-js";
import { loadTestEnv } from "../load-test-env";

const E2E_TEST_USER_EMAIL = "kregielm@gmail.com";

/**
 * Deletes the tuya_oauth_tokens row for the e2e test user, so re-running
 * e2e/tuya-oauth-connect.spec.ts is idempotent.
 */
export async function deleteTuyaOAuthTokenForTestUser(): Promise<void> {
  loadTestEnv();

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.test for tuya-cleanup");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) throw new Error(`Failed to list users: ${error.message}`);

  const user = data.users.find((candidate) => candidate.email === E2E_TEST_USER_EMAIL);
  if (!user) {
    throw new Error(`E2E test user not found: ${E2E_TEST_USER_EMAIL}`);
  }

  const { error: deleteError } = await supabase.from("tuya_oauth_tokens").delete().eq("user_id", user.id);
  if (deleteError) throw new Error(`Failed to delete tuya_oauth_tokens: ${deleteError.message}`);
}
