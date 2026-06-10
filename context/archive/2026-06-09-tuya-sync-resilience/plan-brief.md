# Tuya Sync Resilience — Plan Brief

> Full plan: `context/changes/tuya-sync-resilience/plan.md`
> Research: `context/changes/tuya-sync-resilience/research.md`

## What & Why

Phase 3 of the test rollout closes risk R3: _Tuya OAuth token expires silently →
consumption readings stop → limit never evaluated → no alarm fires._ The phase both
adds test coverage and fixes the two production code paths that make the risk real today.

## Starting Point

Token expiry is checked proactively via timestamp comparison, and a refresh path exists
in `resolveAccessToken()`. However, if Tuya returns error code 1010 (token invalid
server-side), there is no catch-and-retry. Separately, all errors — including fatal ones
like missing config — are swallowed by a blanket catch in `scheduled.ts`, making
failures invisible to Cloudflare.

## Desired End State

`isAccessTokenExpired()` has a unit test suite covering the 60-second skew boundary.
`syncMeterReading()` catches Tuya token errors and retries once with a forced refresh.
`runScheduledJob()` re-throws fatal errors. Four integration tests verify the full
refresh-and-sync flow end-to-end, including the guarantee that a failed refresh produces
no stale write to `consumption_readings`.

## Key Decisions Made

| Decision             | Choice                                                                     | Why (1 sentence)                                                  | Source |
| -------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------ |
| Code fixes in scope  | Yes — fix silent-swallow + add retry                                       | A test that only documents broken behavior is not protection      | Plan   |
| Error signal         | Non-empty `errors` array in `runBatchTuyaSync()` return value              | Already the return shape; assertable without interface changes    | Plan   |
| Stale-data detection | Assert no `consumption_readings` row written on failure                    | Testable today; no schema change needed                           | Plan   |
| 401 retry strategy   | Catch `TUYA_TOKEN_EXPIRED` / `TUYA_AUTH_FAILED`, force-refresh, retry once | Standard OAuth pattern; single retry prevents loops               | Plan   |
| `scheduled.ts` fix   | Re-throw fatal errors after logging                                        | Makes config/DB outages visible to Cloudflare                     | Plan   |
| Refresh token expiry | `.todo` test only, no validation code                                      | Narrower scope; gap is named without widening the production diff | Plan   |

## Scope

**In scope:**

- Unit tests for `isAccessTokenExpired()` (node pool)
- 401 catch-and-retry in `syncMeterReading()` (user-OAuth path only)
- Re-throw fatal errors from `runScheduledJob()`
- Workers-pool integration tests: T1 refresh happy-path, T2 retry on 1010, T3 no-stale-write, T4 fatal propagation
- `vitest.workers.config.ts` glob expansion
- `test-plan.md` Phase 3 status → `shipped`

**Out of scope:**

- `fetched_at` column / schema migration
- `refresh_token_expires_at` validation code
- Cloudflare cron observability / alerting
- Per-meter loop behavior changes in `cron-sync.ts`

## Architecture / Approach

Three phases in dependency order. Phase 1 (unit tests) is independently shippable — it
tests a pure function with no infrastructure. Phase 2 (production fixes) modifies two
files: a one-line re-throw in `scheduled.ts` and a catch-and-retry block in
`syncMeterReading()` scoped to the user-OAuth branch. Phase 3 (integration tests)
depends on the Phase 2 fixes to pass; it also expands the Workers-pool glob and marks
the test-plan phase shipped.

## Phases at a Glance

| Phase                         | What it delivers                                                                         | Key risk                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1. Token Expiry Unit Tests    | Oracle-first `it.each` suite for `isAccessTokenExpired()`; `.todo` for refresh-token gap | Test fixture type mismatch if `expiresAt` param type differs from assumption   |
| 2. Production Code Fixes      | Retry-on-1010 in `syncMeterReading()`; fatal re-throw in `scheduled.ts`                  | Broad catch without type guard could retry on non-token errors                 |
| 3. Integration Tests + Config | T1–T4 in Workers pool; glob update; test-plan marked shipped                             | T4 (fatal propagation) may need careful env-mock setup in Workers pool context |

**Prerequisites:** Phase 1–2 test infra already shipped; `.env.test` populated with real Supabase test-DB credentials and Tuya dummy values.  
**Estimated effort:** ~2 sessions across 3 phases.

## Open Risks & Assumptions

- The exact property name on `TuyaServiceError` for the error code (used in the retry
  type guard) must be confirmed from `tuya-errors.ts` before writing Phase 2 code.
- T4 (fatal propagation) in the Workers pool requires mocking `getTuyaConfig` or a
  Cloudflare binding — verify this is achievable with `vi.mock` inside `defineWorkersProject`.
- `refresh_token_expires_at` gap is explicitly left open; if a refresh token expires in
  production before it is addressed, the sync will fail silently on the refresh call.

## Success Criteria (Summary)

- `npm test` passes twice consecutively (idempotency).
- A deliberately expired token in the test DB triggers `refreshAccessToken` and a new
  token row is saved.
- A failed token refresh produces no `consumption_readings` insert and a non-empty
  `errors` array in the job return value.
