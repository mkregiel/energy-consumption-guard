<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Testing E2E Critical User Journeys

- **Plan**: context/changes/testing-e2e-critical-user-journeys/plan.md
- **Scope**: All phases (1-5)
- **Date**: 2026-06-12
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | WARNING |

## Findings

### F1 — Tuya OAuth error test fails consistently

- **Severity**: WARNING
- **Impact**: MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Success Criteria
- **Location**: e2e/tuya-oauth-connect.spec.ts:55
- **Detail**: The `afterAll` in `tuya-oauth-connect.spec.ts` calls `deleteTuyaOAuthTokenForTestUser()` which requires `SUPABASE_LOCAL_URL` and `SUPABASE_LOCAL_SERVICE_ROLE_KEY` in `.env.test`. These vars are documented in `.env.test.example` but not present in this worktree's `.env.test`, causing the error-path test to fail on all 3 browsers. Phase 3 issue.
- **Fix**: Add `SUPABASE_LOCAL_URL` and `SUPABASE_LOCAL_SERVICE_ROLE_KEY` to the worktree's `.env.test` with the correct local Supabase credentials.
  - Strength: Fixes the 3 consistently failing tests immediately.
  - Tradeoff: .env.test is gitignored — each worktree needs manual setup.
  - Confidence: HIGH — the error message names the exact missing vars.
  - Blind spot: Whether the main repo's .env.test has these vars.
- **Decision**: FIXED — added `SUPABASE_LOCAL_URL`/`SUPABASE_LOCAL_SERVICE_ROLE_KEY` to `.env.test` (using the local CLI's `Project URL` + new `Secret` key, the replacement for the legacy `service_role` JWT). All 6 tuya-oauth-connect tests pass (chromium/firefox/webkit). Also recorded as a lesson in `context/foundation/lessons.md`.

### F2 — Hardcoded test credentials in committed files

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: e2e/auth-redirect.spec.ts:17-18, e2e/global-setup.ts:16
- **Detail**: Test email (`kregielm@gmail.com`) and password (`asdzxc`) appear as string literals in committed files. Pre-existing pattern from `global-setup.ts` that Phase 4 followed consistently.
- **Fix**: Extract to `.env.test` vars and read via `process.env` in a follow-up change.
- **Decision**: FIXED — added `E2E_TEST_USER_EMAIL`/`E2E_TEST_USER_PASSWORD` to `.env.test`/`.env.test.example`; `global-setup.ts`, `auth-redirect.spec.ts`, and `e2e/lib/tuya-cleanup.ts` now read these via `process.env` (loaded via `loadTestEnv()`). 9-test e2e run (auth-redirect + tuya-oauth-connect) passes.

### F3 — networkidle wait pattern

- **Severity**: WARNING
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: e2e/auth-redirect.spec.ts:13, e2e/dashboard-forms.spec.ts:10,29
- **Detail**: `waitForLoadState("networkidle")` used in 3 places. Not a CLAUDE.md violation but Playwright docs discourage it. Consistent with pre-existing `seed.spec.ts` and `global-setup.ts` pattern.
- **Fix**: Replace with `await expect(specificElement).toBeVisible()` in a follow-up cleanup.
- **Decision**: ACCEPTED-AS-RULE — `networkidle` is required here to let Astro `client:load` hydration finish before filling forms (confirmed by the author from prior debugging); removing it causes flaky failures. Recorded as a lesson in `context/foundation/lessons.md` documenting this as a deliberate exception to the general Playwright guidance. Added explanatory comments at all 3 call sites (auth-redirect.spec.ts, dashboard-forms.spec.ts x2) instead of removing the wait.

### F4 — .dev.vars left mutated after abnormal exit

- **Severity**: OBSERVATION
- **Impact**: LOW
- **Dimension**: Safety & Quality
- **Location**: e2e/start-webserver.ts:50-66
- **Detail**: If the process is SIGKILL'd before `shutdown()` runs, `.dev.vars` retains the stub URL. Low likelihood — SIGTERM and SIGINT are handled.
- **Decision**: SKIPPED — accepted risk, low likelihood.

### F5 — listUsers() without email filter

- **Severity**: OBSERVATION
- **Impact**: LOW
- **Dimension**: Safety & Quality
- **Location**: e2e/lib/tuya-cleanup.ts:28
- **Detail**: `supabase.auth.admin.listUsers()` fetches all users to find one by email. Acceptable for a test-only cleanup helper against a local dev database.
- **Decision**: FIXED + ACCEPTED-AS-RULE — GoTrue's admin `listUsers()` has no email-filter param, only pagination. Added `{ perPage: 200 }` with an explanatory comment to keep the call bounded. Recorded as a lesson in `context/foundation/lessons.md`.
