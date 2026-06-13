// tests/global-setup.ts
import { chromium, expect, type FullConfig } from "@playwright/test";
import { loadTestEnv } from "./load-test-env";

async function globalSetup(_config: FullConfig) {
  loadTestEnv();

  const email = process.env.E2E_TEST_USER_EMAIL;
  const password = process.env.E2E_TEST_USER_PASSWORD;
  if (!email || !password) {
    throw new Error("E2E_TEST_USER_EMAIL and E2E_TEST_USER_PASSWORD must be set in .env.test");
  }

  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto("https://127.0.0.1:3000/auth/signin");

  // The form hydrates client-side (client:load); wait for hydration to finish
  // before typing, otherwise React remounts with empty state and wipes input
  // typed into the still-server-rendered markup.
  await page.waitForLoadState("networkidle");

  const emailInput = page.getByRole("textbox", { name: "email" });
  await emailInput.fill(email);
  await expect(emailInput).toHaveValue(email);

  const passwordInput = page.getByRole("textbox", { name: "password" });
  await passwordInput.fill(password);
  await expect(passwordInput).toHaveValue(password);
  await expect(emailInput).toHaveValue(email);

  await page.getByRole("button", { name: "Sign in" }).click();

  // wait for dashboard
  await page.waitForURL("https://127.0.0.1:3000/");

  // save session state to file
  await page.context().storageState({ path: "e2e/user.json" });

  await browser.close();
}

export default globalSetup;
