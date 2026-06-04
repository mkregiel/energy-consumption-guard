# Email Alarm on Limit Breach — Plan Brief

> Full plan: `context/changes/email-alarm-on-limit-breach/plan.md`

## What & Why

S-05 is the end-to-end verification slice that closes Stream B. The full alarm pipeline is already built (F-03 evaluates limits, F-04 sends emails, S-04 lets users configure the address) but has never been exercised as a whole with a real email delivery confirmed. This change proves the pipeline works.

## Starting Point

The cron jobs `/api/cron/evaluate-limits` and `/api/cron/send-notifications` are deployed and wired on Cloudflare. There is no way to trigger them on demand with test data short of waiting for a real cron tick or manually inserting rows in Supabase Studio.

## Desired End State

Running `npm run seed:test-breach` plants a minimal test fixture (meter + limit + reading + alarm email), fires both cron endpoints, and the tester receives the Polish-language alarm email at `TEST_EMAIL` within seconds. A `--cleanup` flag removes all test rows, making the script safe to run repeatedly.

## Key Decisions Made

| Decision         | Choice                                 | Why (1 sentence)                                                         | Source |
| ---------------- | -------------------------------------- | ------------------------------------------------------------------------ | ------ |
| Test form        | Seed script + manual checklist         | Exercises the real pipeline with no mocking                              | Plan   |
| Seeding strategy | SQL upserts + HTTP cron trigger        | Uses exact production code path without waiting for scheduled cron       | Plan   |
| Script runtime   | `tsx` (TypeScript, no build step)      | Consistent with TS codebase; importable types without a compile step     | Plan   |
| Cleanup          | `--cleanup` flag (default: leave rows) | Safe to run repeatedly; tester can inspect DB before cleanup             | Plan   |
| Env scope        | Staging/preview only                   | E2E means real Resend + real Supabase; no local mock mode                | Plan   |
| No src/ imports  | Script is self-contained               | `email-client.ts` uses `astro:env/server` — not importable outside Astro | Plan   |

## Scope

**In scope:**

- `tsx` dev dependency + `seed:test-breach` npm script
- `scripts/seed-test-breach.ts` — upsert test data, trigger cron endpoints, print results, optional cleanup
- Manual verification checklist

**Out of scope:**

- Automated CI test verifying email delivery
- Mocked Resend integration test
- New production code (no service module, API, or migration changes)
- Local-only dev mode

## Architecture / Approach

The script uses `@supabase/supabase-js` (already a project dependency) with the service role key to bypass RLS, and native `fetch` to call the two cron HTTP endpoints with `Authorization: Bearer CRON_SECRET`. No imports from `src/`. Required env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `APP_BASE_URL`, `TEST_USER_ID`, `TEST_EMAIL`.

## Phases at a Glance

| Phase          | What it delivers                                                 | Key risk                                                                                                           |
| -------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 1. Add tsx     | `tsx` installed, `npm run seed:test-breach` wired                | None — trivial dependency addition                                                                                 |
| 2. Seed script | Full E2E pipeline exercised via script; email confirmed received | Test user's existing meter/limit rows may conflict — upserts handle this, but alarm_email overwrite must be logged |

**Prerequisites:** Staging Supabase project with a real test user (`TEST_USER_ID`), `RESEND_API_KEY` and `RESEND_FROM_EMAIL` configured in staging, `CRON_SECRET` set.

**Estimated effort:** ~1 session, 1 phase (Phase 1 is trivial; the script is the meat).

## Open Risks & Assumptions

- The test user (`TEST_USER_ID`) must already exist in `auth.users` — the script can't create auth users via the service role JS client.
- `meters.user_id` is UNIQUE — the upsert will silently overwrite the test user's existing meter label and `tuya_device_id`. This is acceptable for staging only.
- If the staging Resend `RESEND_FROM_EMAIL` is not a verified sender, emails will silently fail at the Resend layer (non-2xx response surfaced by the script).

## Success Criteria (Summary)

- `npm run seed:test-breach` exits 0, prints `"sent": 1` from the notification job
- `TEST_EMAIL` inbox receives the alarm email with correct subject and body within ~30 seconds
- `--cleanup` removes all test rows and exits 0
