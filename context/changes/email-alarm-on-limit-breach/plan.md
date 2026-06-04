# Email Alarm on Limit Breach — E2E Verification Plan

## Overview

S-05 closes the alarm pipeline loop. All infrastructure is built (F-03 evaluates limits, F-04 sends emails, S-04 provides the UI to configure the alarm email). This plan adds a reusable seed script that plants minimal test data, triggers both cron jobs via HTTP, and confirms a notification email is dispatched and received.

## Current State Analysis

The full pipeline exists and is wired:

1. `POST /api/cron/evaluate-limits` (`:05` UTC) — reads `consumption_readings`, sums `kwh_delta` in the current window, inserts `limit_breach_events` when consumption > threshold.
2. `POST /api/cron/send-notifications` (`:10` UTC) — queries unnotified breaches, fetches `notification_settings.alarm_email`, sends via Resend, marks `notified_at`.

**What's missing:** no script to exercise the pipeline on demand; no verified proof that a real email is delivered end-to-end.

### Key Discoveries

- `email-client.ts` imports `astro:env/server` — cannot be imported outside Astro. The script must call Resend (and Supabase) directly via REST, not via service modules.
- `meters`, `consumption_limits`, `notification_settings`, and `limit_breach_events` all carry `UNIQUE (user_id)` or PK-on-user_id constraints. The script may conflict with existing rows for the test user and must handle upserts or error gracefully.
- `meters.user_id` is UNIQUE — only one meter per user. The script must check for and reuse or create a meter.
- `limit_breach_events` has a `(limit_id, window_start)` unique index (added by migration `20260531193000`). The script must use a distinct `window_start` to avoid conflicts with real breach events.
- `src/lib/services/limit-evaluation.ts` sums `kwh_delta` via Supabase RPC (`sum_kwh_delta_in_window`). The seed inserts a reading with `kwh_delta` above the threshold so evaluate-limits fires the breach naturally.

## Desired End State

Running `npm run seed:test-breach` against a staging environment:

1. Plants a test meter, limit (0.01 kWh, day window), reading (0.05 kWh delta), and notification_settings row.
2. POSTs `/api/cron/evaluate-limits` → response confirms 1 breach created.
3. POSTs `/api/cron/send-notifications` → response confirms 1 email sent.
4. Tester receives the alarm email at `TEST_EMAIL` within seconds.
5. `--cleanup` deletes all inserted test rows (meter, limit, readings, breach event, notification settings).

## What We're NOT Doing

- No automated CI test — verifying real email delivery requires an external mailbox.
- No mocking of Resend — this is a real send against the live API.
- No new production code (no changes to service modules, API routes, or migrations).
- No local-only mode — the script targets a real Supabase + Resend environment.

## Implementation Approach

Single-phase script using the `@supabase/supabase-js` service role client (already a project dependency) plus native `fetch` for cron HTTP calls. `tsx` enables running TypeScript directly from the command line without a build step. The script is self-contained: no imports from `src/`.

## Phase 1: Add tsx and package.json script

### Overview

Install `tsx` as a dev dependency and register the npm convenience script so the seed is runnable without knowing the `tsx` binary path.

### Changes Required

#### 1. Install tsx

**File**: `package.json`

**Intent**: Add `tsx` to `devDependencies` so TypeScript files in `scripts/` can run directly.

**Contract**: `"tsx": "^4.x"` in `devDependencies`. Add `"seed:test-breach": "tsx scripts/seed-test-breach.ts"` to `scripts`.

### Success Criteria

#### Automated Verification

- `npm install` completes without error
- `npx tsx --version` prints a version string

#### Manual Verification

- `npm run seed:test-breach -- --help` (or without args) prints usage without crashing

---

## Phase 2: Write `scripts/seed-test-breach.ts`

### Overview

The script orchestrates the full pipeline:

1. Read env vars; abort with a clear message if any are missing.
2. Upsert test data in order: `meters` → `consumption_limits` → `consumption_readings` → `notification_settings`.
3. POST `/api/cron/evaluate-limits` with `Authorization: Bearer CRON_SECRET`.
4. POST `/api/cron/send-notifications` with the same auth header.
5. Print structured JSON results from both jobs.
6. If `--cleanup` is passed, delete all rows inserted in step 2 (in reverse FK order).

### Changes Required

#### 1. `scripts/seed-test-breach.ts`

**File**: `scripts/seed-test-breach.ts`

**Intent**: Standalone TypeScript script — no imports from `src/`. Uses `@supabase/supabase-js` directly with the service role key to bypass RLS.

**Contract**:

Required env vars (read from `process.env`; abort if absent):

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET`
- `APP_BASE_URL` — e.g. `https://my-app.pages.dev`
- `TEST_USER_ID` — UUID of an existing user in `auth.users`
- `TEST_EMAIL` — the address that should receive the alarm

CLI flag: `--cleanup` — when present, delete all test rows after printing job results.

Insertion strategy:

- **meters**: `upsert` on `user_id` (conflict target). Store the returned `id` for cleanup.
- **consumption_limits**: `upsert` on `user_id`. Threshold: `0.01` kWh, window: `'day'`, timezone: `'Europe/Warsaw'`. Store returned `id`.
- **consumption_readings**: `insert` one row — `kwh_delta: 0.05`, `kwh_cumulative: 0.05`, `source: 'manual'`, `recorded_at: now()`. Store returned `id` for cleanup.
- **notification_settings**: `upsert` on `user_id` with `alarm_email: TEST_EMAIL`. Note: this overwrites any existing alarm email for the test user; log a warning if a pre-existing row was present.

After insertions, POST both cron endpoints sequentially (evaluate-limits first, send-notifications second). Print the full JSON response body from each.

Cleanup (reverse FK order): delete `consumption_readings` by id → delete `limit_breach_events` by `limit_id` (catches any breach created by the job) → delete `consumption_limits` by id → delete `meters` by id → delete `notification_settings` by `user_id`.

Exit with code 1 if any step fails.

### Success Criteria

#### Automated Verification

- `npm run seed:test-breach` exits 0 (requires valid staging env vars in shell)
- `npx tsc --noEmit scripts/seed-test-breach.ts` passes (or `npx tsx --check`)
- ESLint passes: `npm run lint`

#### Manual Verification

- Script prints evaluate-limits result with `"breached": 1`
- Script prints send-notifications result with `"sent": 1`
- `TEST_EMAIL` inbox receives the alarm email within ~30 seconds
- Email subject is `[Monitor energii] Przekroczono limit zużycia`
- Email body mentions the consumption (0.05 kWh) and threshold (0.01 kWh)
- Running again with `--cleanup` prints deletion counts and exits 0
- After cleanup, no test rows remain in `limit_breach_events`, `consumption_readings`, `consumption_limits`, `meters` for the test user_id

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to close out the change.

---

## Testing Strategy

### Manual Testing Steps

1. Copy `.env.local` or export staging secrets into shell.
2. Run `npm run seed:test-breach` — confirm both cron responses show success.
3. Open `TEST_EMAIL` inbox — confirm alarm email arrived.
4. Inspect `limit_breach_events` in Supabase Studio — confirm `notified_at` is set.
5. Run `npm run seed:test-breach -- --cleanup` — confirm rows deleted.
6. Re-run without cleanup to ensure idempotency (upserts don't fail on second run after cleanup).

## Migration Notes

No migrations. No production code changes. The script is purely additive.

## References

- Limit evaluation service: `src/lib/services/limit-evaluation.ts`
- Breach notification service: `src/lib/services/breach-notifications.ts`
- Email client: `src/lib/services/email-client.ts`
- Related change (email dispatch): `context/changes/transactional-email-alerts/plan.md`
- Related change (alarm email UI): `context/changes/configure-alarm-email/plan.md`
- Schema: `supabase/migrations/20260527120000_energy_domain_schema.sql`
- Retry migration: `supabase/migrations/20260602120000_limit_breach_notification_retry.sql`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Add tsx and package.json script

#### Automated

- [x] 1.1 `npm install` completes without error
- [x] 1.2 `npx tsx --version` prints a version string

#### Manual

- [ ] 1.3 `npm run seed:test-breach -- --help` prints usage without crashing

### Phase 2: Write `scripts/seed-test-breach.ts`

#### Automated

- [ ] 2.1 `npm run seed:test-breach` exits 0 against staging env
- [ ] 2.2 TypeScript type-check passes
- [ ] 2.3 ESLint passes: `npm run lint`

#### Manual

- [ ] 2.4 Script prints evaluate-limits result with `"breached": 1`
- [ ] 2.5 Script prints send-notifications result with `"sent": 1`
- [ ] 2.6 `TEST_EMAIL` inbox receives the alarm email within ~30 seconds
- [ ] 2.7 Email subject is `[Monitor energii] Przekroczono limit zużycia`
- [ ] 2.8 Email body mentions the consumption (0.05 kWh) and threshold (0.01 kWh)
- [ ] 2.9 Running with `--cleanup` exits 0 and no test rows remain
