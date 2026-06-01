# Background Limit Evaluation Implementation Plan

## Overview

Implement foundation slice F-03: two scheduled background jobs on Cloudflare Workers — batch Tuya reading sync and consumption limit evaluation — that persist `limit_breach_events` when thresholds are exceeded. No email sending (F-04) and no limit configuration UI (S-03).

This change adds service-role batch access, cron API routes, job services, and Wrangler cron triggers. It reuses F-02 `syncMeterReading` and F-01 schema without new migrations.

## Current State Analysis

- **Schema ready:** F-01 migration defines `consumption_limits` (calendar window + timezone), `consumption_readings` (`kwh_delta`, indexed by meter + time), `limit_breach_events` (`notified_at` for F-04 idempotency) — `supabase/migrations/20260527120000_energy_domain_schema.sql`.
- **Tuya sync ready:** F-02 `syncMeterReading(supabase, client, userId, options)` persists idempotent readings — `src/lib/services/tuya-client.ts:314+`. On-demand route requires session — `src/pages/api/tuya/sync.ts`.
- **No batch/cron code:** `wrangler.jsonc` has no `triggers.crons`. No `SUPABASE_SERVICE_ROLE_KEY` or `CRON_SECRET` in `astro.config.mjs` / `.env.example`.
- **No limit logic:** `consumption_limits` and `limit_breach_events` exist in `src/types.ts` but have no services or queries.
- **Deploy guidance exists:** `context/deployment/deploy-plan.md:346-356` documents hourly UTC cron pattern; `context/foundation/infrastructure.md:91` requires idempotent short handlers.

### Key Discoveries:

- F-02 handoff explicitly defers cron sync and limit evaluation to F-03 — reads `consumption_readings` only for evaluation (`context/changes/tuya-read-integration/change.md:57-58`).
- Energy schema plan notes F-03 cron uses service role key — not added in F-01 (`context/changes/energy-domain-schema/plan.md:289`).
- Dashboard query loads last N readings only — no window aggregation (`src/lib/services/consumption-query.ts`).
- RLS grants `service_role` bypass for batch jobs — migration lines 225+ in energy schema.

## Desired End State

After this plan:

1. Two Cloudflare Cron Triggers run hourly UTC: sync at `:00`, evaluate at `:05`.
2. `POST /api/cron/sync-readings` batch-syncs Tuya consumption for all users with a meter and linked Tuya account.
3. `POST /api/cron/evaluate-limits` evaluates every `consumption_limits` row: sum `kwh_delta` in current calendar window (day/week/month in limit timezone) vs `threshold_kwh`.
4. When exceeded and no breach exists for that limit in the current window, insert one `limit_breach_events` row (`notified_at = null`).
5. Both jobs return structured JSON summaries; failures per user do not abort the whole batch.
6. Manual triggering works locally via `curl` + `CRON_SECRET`.
7. F-04 can query unnotified breaches: `notified_at IS NULL`.

## What We're NOT Doing

- Email sending or templating (F-04 / S-05)
- UI or authenticated API for configuring limits (S-03) — test via Supabase Studio INSERT
- Updating `notified_at` (F-04 responsibility)
- New Supabase migrations or schema changes
- `job_runs` audit table
- Global `/api/*` middleware guard (F-05)
- Multiple limits per user (FR-006)
- Anomaly detection / ML heuristics (PRD Non-Goals)
- GitHub Actions as primary scheduler (acceptable fallback only)

## Implementation Approach

Incremental backend-first approach aligned with F-02 patterns:

1. Add secrets and service-role client (foundation for all batch work).
2. Implement limit evaluation service + HTTP route (core F-03 outcome).
3. Implement batch Tuya sync service + HTTP route (separate cron per user decision).
4. Wire Cloudflare crons via scheduled dispatcher calling the same service functions.
5. Document manual verification runbook and F-04 handoff contract.

Job services are the single source of truth; HTTP routes are thin wrappers for auth + JSON envelope. Scheduled handler calls services directly (no self-HTTP fetch) to avoid extra latency and timeout risk.

## Critical Implementation Details

### Timing & lifecycle

Run sync cron (`0 * * * *`) before evaluate cron (`5 * * * *`) so fresh readings exist before window aggregation. Evaluate cron must remain fast — no Tuya calls inside evaluation path.

### State sequencing

For each limit evaluation: compute window bounds → query readings → sum deltas → check existing breach in window → insert if needed. Breach insert must happen only after idempotency check passes to avoid duplicate events under concurrent cron invocations.

### Debug & observability

Both jobs return JSON with `{ job, startedAt, finishedAt, stats: { processed, skipped, breached, errors }, errors: [...] }`. Log errors with `console.error` including `userId` / `limitId` for `wrangler tail` correlation. Do not log `CRON_SECRET` or tokens.

## Phase 1: Cron Infrastructure

### Overview

Add server secrets, service-role Supabase client, and shared cron auth helper used by both job routes.

### Changes Required:

#### 1. Environment schema

**File:** `astro.config.mjs`

**Intent:** Declare batch-job secrets so Astro validates them at build/runtime.

**Contract:** Add `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` as `envField.string({ context: "server", access: "secret", optional: true })`.

#### 2. Local env template

**File:** `.env.example`

**Intent:** Document new secrets for local cron testing without committing values.

**Contract:** Add commented placeholders for `SUPABASE_SERVICE_ROLE_KEY` (Supabase dashboard → Settings → API → service_role) and `CRON_SECRET` (random string for local/manual cron calls).

#### 3. Service role client

**File:** `src/lib/supabase-service-role.ts`

**Intent:** Provide a Supabase client that bypasses RLS for batch cron operations.

**Contract:** Export `createServiceRoleClient(): SupabaseClient | null` using `createClient` from `@supabase/supabase-js` with `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. Return `null` when env missing (routes return 500 with clear code). No cookie/session handling.

#### 4. Cron auth helper

**File:** `src/lib/services/cron-auth.ts`

**Intent:** Centralize Bearer token validation for cron HTTP routes.

**Contract:** Export `assertCronAuthorized(request: Request): Response | null` — returns `null` when `Authorization: Bearer <CRON_SECRET>` matches; otherwise returns 401 JSON `{ ok: false, error: { code: "CRON_UNAUTHORIZED", message } }`. Constant-time comparison not required for MVP but avoid logging the header value.

#### 5. Cron JSON response helpers

**File:** `src/lib/services/cron-api-response.ts`

**Intent:** Consistent JSON envelope for job routes (parallel to `tuya-api-response.ts`).

**Contract:** Export `cronJsonSuccess(status, data)` and `cronJsonError(status, code, message, details?)` returning `{ ok: true, data }` / `{ ok: false, error: { code, message, details? } }`.

### Success Criteria:

#### Automated Verification:

- `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` appear in `astro.config.mjs` env schema
- `src/lib/supabase-service-role.ts` and `src/lib/services/cron-auth.ts` exist
- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- `.env.example` documents both new variables with brief usage notes
- Local `.env` can instantiate service role client against local Supabase (no runtime error when keys set)

**Implementation Note:** After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Limit Evaluation Service and Route

### Overview

Implement calendar-window consumption aggregation, idempotent breach event creation, and the evaluate-limits cron HTTP route.

### Changes Required:

#### 1. Window bounds helper

**File:** `src/lib/services/consumption-window.ts`

**Intent:** Compute calendar window start/end for a limit's `window_type` and `timezone`.

**Contract:** Export `getWindowBounds(windowType: WindowType, timezone: string, referenceDate?: Date): { windowStart: Date; windowEnd: Date }`.

Rules:

- `day`: local midnight to next midnight in `timezone`
- `week`: ISO week (Monday 00:00 local) through next Monday 00:00
- `month`: first day 00:00 local through first day of next month 00:00
- Use native `Intl` APIs only (no new date library dependency)
- Export ISO strings helper if needed: `toIso(d: Date): string`

#### 2. Limit evaluation service

**File:** `src/lib/services/limit-evaluation.ts`

**Intent:** Batch-evaluate all consumption limits and emit breach events.

**Contract:** Export types:

```typescript
export interface LimitEvaluationJobResult {
  job: "evaluate-limits";
  startedAt: string;
  finishedAt: string;
  stats: { processed: number; skipped: number; breached: number; errors: number };
  errors: Array<{ userId?: string; limitId?: string; code: string; message: string }>;
}
```

Export `runLimitEvaluation(supabase: SupabaseClient): Promise<LimitEvaluationJobResult>`.

Algorithm per `consumption_limits` row:

1. Load user's meter via `meters.user_id` — skip with reason `NO_METER` if missing.
2. Compute `{ windowStart, windowEnd }` from limit's `window_type` + `timezone`.
3. Query `consumption_readings` for `meter_id` where `recorded_at >= windowStart AND recorded_at < windowEnd`.
4. Sum `kwh_delta` treating NULL as 0.
5. If no readings in window → skip with reason `NO_READINGS` (silent skip per plan decision).
6. If sum <= `threshold_kwh` → skip (below threshold).
7. Idempotency: query `limit_breach_events` where `limit_id = limit.id AND breached_at >= windowStart` — if row exists, skip (already breached this window).
8. Insert `{ limit_id, user_id, breached_at: now ISO, consumption_kwh: sum, notified_at: null }`.
9. Increment `breached` stat.

On per-row failure: catch, push to `errors`, increment `errors`, continue batch.

#### 3. Evaluate limits API route

**File:** `src/pages/api/cron/evaluate-limits.ts`

**Intent:** HTTP entry point for manual and fallback cron invocation.

**Contract:**

- `export const prerender = false`
- `export const POST: APIRoute` only (405 for other methods)
- Call `assertCronAuthorized(request)` first
- Instantiate service role client; 500 `CRON_NOT_CONFIGURED` if null
- Call `runLimitEvaluation(supabase)`; return `cronJsonSuccess(200, result)`
- Top-level catch → `cronJsonError(500, "CRON_JOB_FAILED", ...)`

No `locals.user` check — auth is CRON_SECRET only.

### Success Criteria:

#### Automated Verification:

- `src/lib/services/consumption-window.ts` and `src/lib/services/limit-evaluation.ts` exist
- `src/pages/api/cron/evaluate-limits.ts` exports `POST` with `prerender = false`
- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- Seed in Studio: user with meter, limit (`threshold_kwh` low), readings with `kwh_delta` summing above threshold in current window
- `POST /api/cron/evaluate-limits` with valid Bearer → one `limit_breach_events` row
- Repeat call in same window → no duplicate breach row
- User with limit but no readings → `skipped` increment, job returns 200

**Implementation Note:** After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Batch Tuya Sync Service and Route

### Overview

Implement batch sync for all eligible users, reusing F-02 sync logic without user session.

### Changes Required:

#### 1. Batch sync service

**File:** `src/lib/services/cron-sync.ts`

**Intent:** Iterate users with meters and Tuya tokens; call existing sync for each.

**Contract:** Export types mirroring evaluate job (`job: "sync-readings"`, same stats shape).

Export `runBatchTuyaSync(supabase: SupabaseClient): Promise<CronSyncJobResult>`.

Algorithm:

1. Early exit with error if Tuya config missing (`getMissingTuyaConfigKeys()` from `tuya-config.ts`).
2. Query eligible users: join `meters` with `tuya_oauth_tokens` on `user_id` (service role sees all rows). Select `user_id`, `meters.id as meter_id`.
3. Create one `TuyaClient` via `createTuyaClient(getTuyaConfig())` — reuse across iterations.
4. Per user: call `syncMeterReading(supabase, client, userId, { meterId })`.
5. On success: increment `processed`.
6. On `TuyaServiceError` or other error: push to `errors`, increment `errors`, continue.
7. Skip users without token/meter already excluded by query.

Do not fail entire job when one user sync fails (Tuya timeout risk per `infrastructure.md:108`).

#### 2. Sync readings API route

**File:** `src/pages/api/cron/sync-readings.ts`

**Intent:** HTTP entry point for sync cron job.

**Contract:** Same structure as evaluate route: `POST`, `prerender = false`, `assertCronAuthorized`, service role client, call `runBatchTuyaSync`, return JSON result.

### Success Criteria:

#### Automated Verification:

- `src/lib/services/cron-sync.ts` and `src/pages/api/cron/sync-readings.ts` exist
- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- User with linked Tuya + meter: cron sync creates/updates `consumption_readings`
- User without Tuya link: not in batch (no error abort)
- Invalid `CRON_SECRET` → 401 on both cron routes

**Implementation Note:** After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Wrangler Cron Triggers and Scheduled Dispatcher

### Overview

Wire Cloudflare Cron Triggers to invoke job services on schedule in production.

### Changes Required:

#### 1. Wrangler cron configuration

**File:** `wrangler.jsonc`

**Intent:** Register two hourly UTC cron schedules.

**Contract:** Add:

```jsonc
"triggers": {
  "crons": ["0 * * * *", "5 * * * *"]
}
```

First expression = sync; second = evaluate (5 minutes offset).

#### 2. Scheduled dispatcher

**File:** `src/scheduled.ts`

**Intent:** Route Cloudflare `scheduled` events to the correct job service.

**Contract:** Export `scheduled` handler accepting `ScheduledEvent`. Switch on `event.cron`:

- `"0 * * * *"` → create service role client → `runBatchTuyaSync`
- `"5 * * * *"` → create service role client → `runLimitEvaluation`

Log result JSON via `console.log`. On missing env, log error and return without throw (avoid retry storms).

#### 3. Custom worker entry (Astro + scheduled export)

**File:** `src/worker.ts` (or path required by `@astrojs/cloudflare` worker entry configuration)

**Intent:** Combine Astro SSR handler with `scheduled` export so Wrangler receives both `fetch` and `scheduled`.

**Contract:** Re-export Astro Cloudflare server entry as default export; re-export `scheduled` from `./scheduled`. Update `wrangler.jsonc` `"main"` if build output requires custom entry — follow `@astrojs/cloudflare` v13 worker entry docs for the project's build layout. Verify `npm run build` emits a worker bundle that includes `scheduled`.

#### 4. README cron section

**File:** `README.md`

**Intent:** Document how operators trigger and monitor cron jobs.

**Contract:** Add section covering:

- Required secrets: `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` (+ existing Supabase/Tuya)
- Production: `npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET`
- Manual local trigger (PowerShell example):

  ```powershell
  Invoke-WebRequest -Method POST -Uri "http://127.0.0.1:3000/api/cron/evaluate-limits" -Headers @{ Authorization = "Bearer $env:CRON_SECRET" }
  ```

- Monitor: `npx wrangler tail energy-monitor`
- Cron schedule in UTC; sync at :00, evaluate at :05

#### 5. Deploy plan cross-reference

**File:** `context/deployment/deploy-plan.md`

**Intent:** Mark FR-005 cron section as implemented (optional one-line status update in Future section — only if team tracks deploy-plan checkboxes).

**Contract:** Optional note that cron routes exist; human approval still required for first production secret rotation.

### Success Criteria:

#### Automated Verification:

- `wrangler.jsonc` contains `triggers.crons` with two expressions
- `src/scheduled.ts` exists and exports handler
- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- After deploy to Workers (or `wrangler dev` scheduled test if supported), cron fires invoke expected job (verify via tail logs)
- Scheduled path does not require HTTP self-fetch
- Worker deploy succeeds with cron triggers visible in Cloudflare dashboard

**Implementation Note:** After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Verification and F-04 Handoff

### Overview

End-to-end verification checklist and documentation for downstream email slice.

### Changes Required:

#### 1. Change handoff notes

**File:** `context/changes/background-limit-evaluation/change.md`

**Intent:** Document F-04 integration contract after implementation.

**Contract:** Append section **Handoff — Available for F-04** listing:

- Query pattern: `limit_breach_events WHERE notified_at IS NULL ORDER BY breached_at`
- Fields F-04 should set: `notified_at` after successful email send
- Cron routes and schedules
- JSON response shapes for monitoring

#### 2. F-04 integration contract (in change.md or plan progress notes)

**File:** `context/changes/background-limit-evaluation/change.md`

**Intent:** Prevent F-04 from re-implementing evaluation logic.

**Contract:** Explicit statement: F-04 reads breach events only; does not re-evaluate limits. Idempotency for email uses `notified_at`, not re-inserting breach rows.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- Full scenario: seed limit + readings → evaluate cron → breach row with `notified_at IS NULL`
- Sync cron → new reading → evaluate cron → breach reflects updated sum
- Second evaluate in same window → no duplicate breach
- README cron section accurate for local and production
- Handoff notes complete for F-04 implementer

**Implementation Note:** After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before marking change implemented.

---

## Testing Strategy

### Unit Tests:

- Not applicable — no test runner configured (AGENTS.md). Window math and evaluation verified via manual scenarios.

### Integration Tests:

- Manual HTTP cron calls against local Supabase with seeded data
- Service role client read/write against all domain tables

### Manual Testing Steps:

1. `npx supabase db reset` — ensure schema present
2. Create auth user; insert meter, consumption_limit (low threshold), 3+ readings with `kwh_delta` in current day window
3. `POST /api/cron/evaluate-limits` with Bearer secret → verify breach event
4. Repeat step 3 → verify no duplicate
5. Link Tuya (if available) or mock by direct reading insert; run sync cron → verify readings update
6. Deploy or tail logs to confirm scheduled invocations

## Performance Considerations

- Evaluate job should complete in seconds: one limits query + one readings query + one breach lookup per user (MVP: one limit per user).
- Sync job is the slow path — sequential Tuya calls; acceptable for solo MVP / few users. Document need for batching or queue if user count grows.
- Index `(meter_id, recorded_at DESC)` supports window range queries.
- Keep handlers idempotent for Cloudflare cron retry behavior.

## Migration Notes

No new SQL migrations in this change. Production requires:

1. Human approval before setting `SUPABASE_SERVICE_ROLE_KEY` in Cloudflare (per deploy-plan gate)
2. `npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY`
3. `npx wrangler secret put CRON_SECRET`
4. Deploy worker with cron triggers enabled

Rollback: revert Worker deploy via `wrangler rollback`; breach events already inserted remain (forward-fix acceptable). Disable crons by removing `triggers` and redeploying if jobs must stop immediately.

## References

- Roadmap F-03: `context/foundation/roadmap.md:95-107`
- PRD FR-005 / NFR background: `context/foundation/prd.md:77-85`
- Deploy cron guidance: `context/deployment/deploy-plan.md:346-356`
- Infrastructure risks: `context/foundation/infrastructure.md:78-111`
- F-01 schema: `supabase/migrations/20260527120000_energy_domain_schema.sql`
- F-02 sync handoff: `context/changes/tuya-read-integration/change.md:57-58`
- F-02 sync service: `src/lib/services/tuya-client.ts:314+`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: Cron Infrastructure

#### Automated

- [x] 1.1 `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` appear in `astro.config.mjs` env schema
- [x] 1.2 `src/lib/supabase-service-role.ts` and `src/lib/services/cron-auth.ts` exist
- [x] 1.3 `npm run lint` passes
- [x] 1.4 `npm run build` passes

#### Manual

- [x] 1.5 `.env.example` documents both new variables with brief usage notes
- [x] 1.6 Local `.env` can instantiate service role client against local Supabase

### Phase 2: Limit Evaluation Service and Route

#### Automated

- [ ] 2.1 `src/lib/services/consumption-window.ts` and `src/lib/services/limit-evaluation.ts` exist
- [ ] 2.2 `src/pages/api/cron/evaluate-limits.ts` exports `POST` with `prerender = false`
- [ ] 2.3 `npm run lint` passes
- [ ] 2.4 `npm run build` passes

#### Manual

- [ ] 2.5 Seeded data → evaluate cron creates one breach event
- [ ] 2.6 Repeat evaluate in same window → no duplicate breach
- [ ] 2.7 Limit with no readings → skipped, job returns 200

### Phase 3: Batch Tuya Sync Service and Route

#### Automated

- [ ] 3.1 `src/lib/services/cron-sync.ts` and `src/pages/api/cron/sync-readings.ts` exist
- [ ] 3.2 `npm run lint` passes
- [ ] 3.3 `npm run build` passes

#### Manual

- [ ] 3.4 Linked user → sync cron updates `consumption_readings`
- [ ] 3.5 Invalid `CRON_SECRET` → 401 on both cron routes

### Phase 4: Wrangler Cron Triggers and Scheduled Dispatcher

#### Automated

- [ ] 4.1 `wrangler.jsonc` contains `triggers.crons` with two expressions
- [ ] 4.2 `src/scheduled.ts` exists and exports handler
- [ ] 4.3 `npm run lint` passes
- [ ] 4.4 `npm run build` passes

#### Manual

- [ ] 4.5 Scheduled invocations visible in `wrangler tail` with expected job names
- [ ] 4.6 Worker deploy succeeds; crons visible in Cloudflare dashboard

### Phase 5: Verification and F-04 Handoff

#### Automated

- [ ] 5.1 `npm run lint` passes
- [ ] 5.2 `npm run build` passes

#### Manual

- [ ] 5.3 Full sync → evaluate scenario produces breach with `notified_at IS NULL`
- [ ] 5.4 README cron section accurate
- [ ] 5.5 Handoff notes in `change.md` complete for F-04
