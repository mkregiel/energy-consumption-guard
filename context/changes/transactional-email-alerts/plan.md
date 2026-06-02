# Transactional Email Alerts Implementation Plan

## Overview

Implement foundation slice F-04: a third hourly Cloudflare cron job that sends plain-text limit-breach alarm emails via Resend for rows in `limit_breach_events` where `notified_at` is null, then marks successful deliveries. The job reads breach events only (F-03 handoff) — it does not re-evaluate limits or insert new breach rows.

Retry policy: up to 3 failed send attempts per breach (`notification_attempt_count`); after the third failure, set `notification_failed_at` so the job stops retrying (operator can clear manually in Studio for recovery).

## Current State Analysis

- **Schema ready:** `notification_settings` (`alarm_email` per user) and `limit_breach_events` (`notified_at`, `window_start`, `consumption_kwh`) — `supabase/migrations/20260527120000_energy_domain_schema.sql`, window uniqueness `20260531193000_limit_breach_events_window_start_unique.sql`.
- **Breach producer ready:** F-03 `runLimitEvaluation` inserts breaches with `notified_at: null` — `src/lib/services/limit-evaluation.ts`.
- **Cron infrastructure ready:** Service role client, `cron-auth`, `cron-api-response`, `scheduled.ts` + `wrangler.jsonc` with sync `:00` and evaluate `:05` — `context/changes/background-limit-evaluation/change.md`.
- **No email code:** No Resend/SendGrid dependency in `package.json`; no `RESEND_*` env in `astro.config.mjs`.
- **S-04 not built:** No API/UI for `notification_settings` — F-04 skips breaches without settings and logs `NO_NOTIFICATION_SETTINGS`.
- **HTTP cron gap:** `src/middleware.ts` requires session for all `/api/*` except `/api/auth/*`. Cloudflare `scheduled` bypasses middleware (production OK). Local `Invoke-WebRequest` to `/api/cron/*` may return 401 unless user is logged in — out of scope for this change (see Open Risks).

### Key Discoveries:

- F-03 handoff query: `limit_breach_events WHERE notified_at IS NULL ORDER BY breached_at ASC` — `context/changes/background-limit-evaluation/change.md:17-27`.
- Email format validation deferred to S-04 — F-01 stores non-empty `alarm_email` only (`context/changes/energy-domain-schema/plan.md:88`).
- Roadmap open question on provider resolved in planning: **Resend** (`context/foundation/roadmap.md:123`).

## Desired End State

After this plan:

1. Cron `10 * * * *` UTC runs `runBreachNotifications` via `src/scheduled.ts` (and optional `POST /api/cron/send-notifications` with `CRON_SECRET`).
2. For each eligible breach, the job loads `notification_settings.alarm_email` and limit metadata, sends a plain-text Resend email, sets `notified_at` on success.
3. On Resend failure, increments `notification_attempt_count`; after 3 failures, sets `notification_failed_at` and skips on future runs.
4. Breaches without `notification_settings` are skipped with an entry in `errors[]` (`NO_NOTIFICATION_SETTINGS`); `notified_at` stays null.
5. `RESEND_API_KEY` and `RESEND_FROM_EMAIL` documented in `.env.example`, README, and deploy runbook notes.
6. S-05 implementer has a clear handoff: F-04 handles delivery; S-04 supplies addresses; S-05 is E2E verification only.

## What We're NOT Doing

- S-04: UI/API to configure `notification_settings` (separate change)
- S-05: End-to-end US-01 acceptance slice (depends on S-03, S-04, F-04)
- S-03: Limit configuration UI/API
- Re-running limit evaluation or inserting breach rows
- HTML/React Email templates, i18n, or attachment support
- Middleware allowlist for `/api/cron/` (user chose foundation-only scope)
- Supabase Auth email / SMTP (`supabase/config.toml` SendGrid comments)
- Push/SMS notifications (PRD Non-Goals)
- CI secret for Resend (build must pass without key; optional env like `CRON_SECRET`)

## Implementation Approach

Mirror F-03 cron patterns: job service as single source of truth, thin HTTP route, `scheduled.ts` calls service directly. Use native `fetch` to Resend REST API (no SDK — `workerd`-friendly). One small migration adds retry columns required by the capped-retry decision. Join `consumption_limits` in the notification job for human-readable email content (threshold, window type, timezone).

## Critical Implementation Details

### Timing & lifecycle

Schedule notify cron at **`10 * * * *` UTC** — five minutes after limit evaluation (`5 * * * *`) so new breaches from the same hour are visible before email dispatch.

### State sequencing

Per breach: load settings → if missing, skip → if `notification_failed_at` set, skip → send → on success set `notified_at` only → on failure increment `notification_attempt_count` and optionally set `notification_failed_at` when count ≥ 3. Never set `notified_at` on failed send.

### Debug & observability

Job returns JSON `{ job: "send-notifications", stats: { processed, sent, skipped, failed, errors }, errors[] }` matching F-03 shape. Log Resend HTTP status and breach `id` on failure; never log API keys or full email bodies in production tail.

## Phase 1: Schema and Secrets

### Overview

Add retry-tracking columns on `limit_breach_events` and register Resend-related server secrets.

### Changes Required:

#### 1. Migration — notification retry columns

**File:** `supabase/migrations/20260602120000_limit_breach_notification_retry.sql`

**Intent:** Persist send attempt count and terminal failure timestamp for capped retry policy.

**Contract:**

- `notification_attempt_count INTEGER NOT NULL DEFAULT 0`
- `notification_failed_at TIMESTAMPTZ NULL`
- Check: `notification_attempt_count >= 0`
- No RLS policy changes (`service_role` already bypasses RLS for batch jobs)

#### 2. TypeScript types

**File:** `src/types.ts`

**Intent:** Keep `LimitBreachEvent` aligned with DB for the notification job.

**Contract:** Add `notification_attempt_count: number` and `notification_failed_at: string | null` to `LimitBreachEvent` and `LimitBreachEventInsert` (optional on insert — DB default 0).

#### 3. Astro env schema

**File:** `astro.config.mjs`

**Intent:** Validate Resend secrets at build/runtime.

**Contract:** Add optional server secrets: `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (verified sender address in Resend dashboard, e.g. `alarms@yourdomain.com`).

#### 4. Local env template

**File:** `.env.example`

**Intent:** Document Resend variables for local/manual testing.

**Contract:** Commented placeholders for `RESEND_API_KEY` and `RESEND_FROM_EMAIL` with one-line Resend dashboard pointer.

### Success Criteria:

#### Automated Verification:

- Migration file exists under `supabase/migrations/`
- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- `npx supabase db reset` applies migration without error
- New columns visible on `limit_breach_events` in Studio

**Implementation Note:** After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Email Client and Breach Notification Service

### Overview

Implement Resend HTTP client and batch job that processes unnotified, non-failed breaches.

### Changes Required:

#### 1. Resend email client

**File:** `src/lib/services/email-client.ts`

**Intent:** Thin wrapper around Resend `POST /emails` using `fetch`.

**Contract:**

- Export `isResendConfigured(): boolean` — true when `RESEND_API_KEY` and `RESEND_FROM_EMAIL` are set
- Export `sendPlainTextEmail(params: { to: string; subject: string; text: string }): Promise<void>`
- Use `Authorization: Bearer ${RESEND_API_KEY}`, `Content-Type: application/json`
- On non-2xx response, throw `Error` with status and Resend error body snippet (no API key in message)
- No npm dependency on `resend` package

#### 2. Alarm email content builder

**File:** `src/lib/services/breach-email-content.ts`

**Intent:** Build Polish plain-text body from breach + limit context (MVP product language per PRD).

**Contract:** Export `buildBreachAlarmEmail(params: { consumptionKwh: number; thresholdKwh: number; windowType: WindowType; timezone: string; breachedAt: string; windowStart?: string | null }): { subject: string; text: string }`

Subject example pattern: `[Monitor energii] Przekroczono limit zużycia`
Body includes: zużycie vs próg (kWh), typ okna (`day`/`week`/`month`), strefa czasowa, czas naruszenia — keep under ~2 KB plain text.

#### 3. Breach notification job service

**File:** `src/lib/services/breach-notifications.ts`

**Intent:** Core F-04 batch logic: query, send, update rows.

**Contract:** Export types:

```typescript
export interface BreachNotificationJobResult {
  job: "send-notifications";
  startedAt: string;
  finishedAt: string;
  stats: { processed: number; sent: number; skipped: number; failed: number; errors: number };
  errors: Array<{ userId?: string; breachId?: string; code: string; message: string }>;
}
```

Export `runBreachNotifications(supabase: SupabaseClient): Promise<BreachNotificationJobResult>`.

Constants: `MAX_NOTIFICATION_ATTEMPTS = 3`.

Algorithm:

1. If `!isResendConfigured()`, throw clear error (`RESEND_NOT_CONFIGURED`) — route returns 500.
2. Query breaches: `.from("limit_breach_events").select("*, consumption_limits(threshold_kwh, window_type, timezone)")` with filters `.is("notified_at", null).is("notification_failed_at", null).order("breached_at", { ascending: true })`.
3. Per breach row:
   - Load `notification_settings` for `user_id` (separate query or nested select if efficient).
   - If no settings → `skipped++`, `errors.push({ code: "NO_NOTIFICATION_SETTINGS", ... })`, continue.
   - Build email via `buildBreachAlarmEmail`.
   - Try `sendPlainTextEmail({ to: alarm_email, ... })`.
   - On success: `update({ notified_at: now ISO })` where `id = breach.id`.
   - On failure: `update({ notification_attempt_count: count + 1, notification_failed_at: count + 1 >= 3 ? now ISO : null })`; `failed++` or `errors++`; continue batch.
4. Return job result JSON shape consistent with F-03.

Do not delete breach rows. Do not call `runLimitEvaluation`.

### Success Criteria:

#### Automated Verification:

- `src/lib/services/email-client.ts`, `breach-email-content.ts`, `breach-notifications.ts` exist
- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- With Resend sandbox/key and seeded breach + `notification_settings`, calling `runBreachNotifications` via a one-off script or Phase 3 route delivers email and sets `notified_at`
- Simulated Resend failure increments `notification_attempt_count`; third failure sets `notification_failed_at`
- Breach without settings → skipped, `notified_at` still null

**Implementation Note:** After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Cron Route and Scheduled Wiring

### Overview

Expose the notification job on HTTP (cron secret) and Cloudflare scheduled trigger.

### Changes Required:

#### 1. Send notifications API route

**File:** `src/pages/api/cron/send-notifications.ts`

**Intent:** HTTP fallback for manual/production debugging (same pattern as `evaluate-limits.ts`).

**Contract:** `export const prerender = false`; `POST` only; `assertCronAuthorized` → service role client → `runBreachNotifications` → `cronJsonSuccess` / `cronJsonError`.

#### 2. Scheduled dispatcher

**File:** `src/scheduled.ts`

**Intent:** Register third cron expression and invoke notification job.

**Contract:**

- Add constant `NOTIFY_CRON = "10 * * * *"`
- Branch: `controller.cron === NOTIFY_CRON` → `runBreachNotifications(supabase)`
- Import from `breach-notifications.ts`

#### 3. Wrangler cron triggers

**File:** `wrangler.jsonc`

**Intent:** Register notify schedule in Cloudflare.

**Contract:** Extend `triggers.crons` to `["0 * * * *", "5 * * * *", "10 * * * *"]`.

#### 4. Production secrets (document only)

**File:** `README.md` (Background cron jobs section)

**Intent:** Operators know how to configure Resend in Workers.

**Contract:** Document `npx wrangler secret put RESEND_API_KEY` and `RESEND_FROM_EMAIL`; add row to cron table for `:10` / `POST /api/cron/send-notifications`.

### Success Criteria:

#### Automated Verification:

- `src/pages/api/cron/send-notifications.ts` exists with `POST` + `prerender = false`
- `wrangler.jsonc` lists three cron expressions
- `src/scheduled.ts` handles `10 * * * *`
- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- After deploy, `wrangler tail` shows `send-notifications` JSON summary on `:10` UTC
- Invalid `CRON_SECRET` on new route → 401 (when request reaches handler — see middleware note)
- Worker deploy shows three crons in Cloudflare dashboard

**Implementation Note:** After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Documentation and Downstream Handoff

### Overview

Finalize operator docs and contracts for S-05 and operators recovering failed notifications.

### Changes Required:

#### 1. Change handoff notes

**File:** `context/changes/transactional-email-alerts/change.md`

**Intent:** Document what F-04 delivers and how S-05 should verify.

**Contract:** Append **Handoff — Available for S-05** with:

- Cron schedule `:10` UTC and route path
- Query for pending: `notified_at IS NULL AND notification_failed_at IS NULL`
- Recovery: clear `notification_failed_at` and reset `notification_attempt_count` in Studio to retry
- Dependency: S-04 must populate `notification_settings` for production alarms

#### 2. Deploy plan cross-reference (optional)

**File:** `context/deployment/deploy-plan.md`

**Intent:** Record Resend secrets in production checklist.

**Contract:** Short bullet under secrets/cron section: Resend API key + verified `from` address required before enabling alarm emails; human approval gate unchanged.

#### 3. F-03 upstream note (optional)

**File:** `context/changes/background-limit-evaluation/change.md`

**Intent:** Cross-link F-04 implementation path.

**Contract:** One line pointing to `context/changes/transactional-email-alerts/` for notify cron (optional, non-blocking).

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- README cron table lists three jobs and Resend secrets
- Handoff section in `change.md` complete
- Operator can reset a failed breach and see retry on next `:10` run

**Implementation Note:** After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before marking change implemented.

---

## Testing Strategy

### Unit Tests:

- Not applicable — no test runner (AGENTS.md).

### Integration Tests:

- Manual: seed breach + `notification_settings` → trigger notify job → verify Resend dashboard / inbox
- Manual: force Resend 401 (bad key) → attempt count increments → third attempt sets `notification_failed_at`

### Manual Testing Steps:

1. `npx supabase db reset` — apply retry migration
2. Seed auth user, `consumption_limits`, `limit_breach_events` (`notified_at` null), `notification_settings`
3. Set `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` in `.env`
4. Deploy or invoke notify job (scheduled tail or HTTP if session allows)
5. Confirm email received and `notified_at` set
6. Re-run job → breach not processed again
7. Seed breach without settings → `NO_NOTIFICATION_SETTINGS` in job errors

## Performance Considerations

- Notify job is lightweight (DB reads + one HTTP call per breach). MVP expects few breaches per hour.
- Sequential sends acceptable for solo MVP; parallelize only if tail latency exceeds cron budget.
- Keep handler idempotent — Cloudflare may retry scheduled invocations.

## Migration Notes

- Apply `20260602120000_limit_breach_notification_retry.sql` before deploying job code that writes new columns.
- Production: `npx wrangler secret put RESEND_API_KEY` and `RESEND_FROM_EMAIL` after Resend domain verification.
- Existing breaches get `notification_attempt_count = 0` by default.
- Rollback: revert Worker deploy; migration columns harmless if unused. Clear `notified_at` only for intentional re-send (operator action).

## References

- F-03 handoff: `context/changes/background-limit-evaluation/change.md`
- F-03 plan: `context/changes/background-limit-evaluation/plan.md`
- F-01 schema: `context/changes/energy-domain-schema/plan.md`
- Roadmap F-04: `context/foundation/roadmap.md:113-125`
- PRD US-01 / FR-004–005: `context/foundation/prd.md:51-77`
- Limit evaluation: `src/lib/services/limit-evaluation.ts`
- Cron patterns: `src/pages/api/cron/evaluate-limits.ts`, `src/lib/services/cron-auth.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: Schema and Secrets

#### Automated

- [x] 1.1 Migration file exists under `supabase/migrations/` — 0c588bb
- [x] 1.2 `npm run lint` passes — 0c588bb
- [x] 1.3 `npm run build` passes — 0c588bb

#### Manual

- [x] 1.4 `npx supabase db reset` applies migration without error — 0c588bb
- [x] 1.5 New columns visible on `limit_breach_events` in Studio — 0c588bb

### Phase 2: Email Client and Breach Notification Service

#### Automated

- [x] 2.1 `email-client.ts`, `breach-email-content.ts`, `breach-notifications.ts` exist
- [x] 2.2 `npm run lint` passes
- [x] 2.3 `npm run build` passes

#### Manual

- [x] 2.4 Successful send sets `notified_at`
- [x] 2.5 Third failed attempt sets `notification_failed_at`
- [x] 2.6 Missing `notification_settings` → skip with error code

### Phase 3: Cron Route and Scheduled Wiring

#### Automated

- [ ] 3.1 `src/pages/api/cron/send-notifications.ts` exists
- [ ] 3.2 `wrangler.jsonc` lists three cron expressions
- [ ] 3.3 `src/scheduled.ts` handles `10 * * * *`
- [ ] 3.4 `npm run lint` passes
- [ ] 3.5 `npm run build` passes

#### Manual

- [ ] 3.6 `wrangler tail` shows `send-notifications` on schedule
- [ ] 3.7 Invalid `CRON_SECRET` → 401 when handler reached
- [ ] 3.8 Three crons visible in Cloudflare dashboard

### Phase 4: Documentation and Downstream Handoff

#### Automated

- [ ] 4.1 `npm run lint` passes
- [ ] 4.2 `npm run build` passes

#### Manual

- [ ] 4.3 README documents notify cron and Resend secrets
- [ ] 4.4 Handoff section in `change.md` complete
- [ ] 4.5 Operator can reset failed breach and observe retry
