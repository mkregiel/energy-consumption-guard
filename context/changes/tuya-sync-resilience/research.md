---
date: 2026-06-09T00:00:00+02:00
researcher: Mariusz Kręgiel
git_commit: bfdeab96ccf5f25759298101b1d8d4cdcc1bccae
branch: claude/agitated-carson-da2ab6
repository: mkregiel/energy-consumption-guard
topic: "Tuya sync resilience — token refresh path, error propagation, stale-reading detection"
tags: [research, tuya, token-refresh, cron-sync, error-handling, stale-data, phase-3]
status: complete
last_updated: 2026-06-09
last_updated_by: Mariusz Kręgiel
---

# Research: Tuya Sync Resilience

**Date**: 2026-06-09  
**Researcher**: Mariusz Kręgiel  
**Git Commit**: `bfdeab96ccf5f25759298101b1d8d4cdcc1bccae`  
**Branch**: `claude/agitated-carson-da2ab6`  
**Repository**: mkregiel/energy-consumption-guard

## Research Question

Phase 3 of the test rollout (test-plan.md §3) must cover **R3**: _Tuya OAuth token expires silently → consumption readings stop updating → limit is never evaluated → no alarm ever fires._

Specifically, ground the following before planning:

- Token refresh code path — where expiry is detected, how refresh is triggered, what happens on failure
- Error propagation from the Tuya HTTP client through the sync job
- Whether readings carry a fetch-time that enables stale-data detection
- What test infrastructure already exists from Phases 1–2 that Phase 3 can reuse

## Summary

The token refresh machinery is **structurally present but has critical silent-failure gaps**. Token expiry is checked proactively via timestamp comparison before every API call. However, if the timestamp says "fresh" but Tuya responds with a 401/token-invalid code, there is no catch-and-retry — the error propagates up and is **swallowed at two outer layers** (`scheduled.ts` and the per-target loop in `cron-sync.ts`). The sync job continues for other meters and returns a success-shaped result. No field on `consumption_readings` records when data was fetched from the Tuya API, making stale-data detection impossible without code changes.

The good news: Phase 3 has a mature test harness to stand on. Both the Workers pool (`vitest.workers.config.ts`) and the env-var shimming are already wired. All required patterns (oracle-first unit tests, hoisted module mocks, real-Supabase fixture lifecycle) exist in Phase 1–2 test files and can be copied.

## Detailed Findings

### Token Storage

**`supabase/migrations/20260528120000_tuya_oauth_tokens_and_readings_idempotency.sql:7-18`**

`tuya_oauth_tokens` table columns:

- `user_id` UUID PK
- `access_token` TEXT NOT NULL
- `refresh_token` TEXT NOT NULL
- `access_token_expires_at` TIMESTAMPTZ NOT NULL — the only expiry field actually checked in code
- `refresh_token_expires_at` TIMESTAMPTZ nullable — stored but **never validated in code**
- `tuya_uid` TEXT nullable

TypeScript interface: `src/types.ts:71-82`

### Token Freshness Check — What Exists

**`src/lib/services/tuya-client.ts:23-34`** — `isAccessTokenExpired()`

```
TOKEN_REFRESH_SKEW_MS = 60_000   // 60-second buffer before actual expiry
isAccessTokenExpired(expiresAt, forceRefresh):
  if forceRefresh → always true
  else → (expiresAt - 60 s) <= now()
```

**`src/lib/services/tuya-client.ts:102-122`** — `resolveAccessToken()` (central orchestrator)

1. Loads token from DB via `loadUserOAuthToken()` (line 108)
2. Calls `isAccessTokenExpired()` (line 113)
3. If expired: calls `client.refreshAccessToken(refreshToken)` (line 117)
4. Saves new token via `saveUserOAuthToken()` (line 119)
5. Returns new access token

This is called before every Tuya API call — expiry is checked proactively, not reactively on 401.

### Token Refresh HTTP Call

**`src/lib/services/tuya-http.ts:293-305`** — `refreshAccessToken()`

- GET `/v1.0/token/{refreshToken}` — HMAC-SHA256 signed, no existing access token needed
- Parses `access_token`, `refresh_token`, `expire_time` (defaults to 7200 s if absent)
- **No retry logic** — errors thrown directly to caller

### Gap 1: No 401 Catch-and-Retry at HTTP Layer

**`src/lib/services/tuya-http.ts:126-143`** — `parseTuyaResponse()`

Detects Tuya error codes (line 134): `!response.ok || !payload.success` → throws `TuyaServiceError` via `mapTuyaProviderError()`.

**`src/lib/services/tuya-errors.ts:28-60`** — `mapTuyaProviderError()`

Maps codes:

- 1010, 28841002 → `TUYA_TOKEN_EXPIRED` or `TUYA_AUTH_FAILED` (HTTP 401)
- 1004, 1107, 1109, 28841003 → `TUYA_AUTH_FAILED` (HTTP 401)
- Others → `TUYA_PROVIDER_ERROR` (HTTP 502)

**But `signedRequest()` and its callers (`listLinkedUserDevices`, `syncMeterReading`) have no catch for these 401 codes and no force-refresh retry.** If Tuya says the token is invalid but our local timestamp says it isn't expired yet, the API call fails without any recovery attempt.

### Gap 2: Refresh Token Expiry Never Checked

`refresh_token_expires_at` is stored in the DB (`supabase/migrations/…:13`) and in the TypeScript type (`src/types.ts:78`) but **no code in `tuya-client.ts` or `cron-sync.ts` ever reads or validates it**. If the refresh token has expired, `resolveAccessToken()` will call `refreshAccessToken()` which will return a Tuya error — that error propagates up and is eventually swallowed.

### Sync Job Entry Point and Error Propagation

**`src/scheduled.ts:16-46`** — `runScheduledJob()`

- Top-level `try/catch` at lines 23–45
- On any error: `console.error` at line 44, then **returns void — no re-throw**
- Cloudflare Worker caller receives a resolved Promise regardless of whether the sync succeeded

**`src/lib/services/cron-sync.ts:35-77`** — `runBatchTuyaSync()`

- Config validation (lines 40–50): throws `TuyaServiceError` if Tuya config missing → caught and swallowed by `scheduled.ts`
- `loadEligibleSyncTargets()` (line 52): throws on DB error → same swallow path
- Per-target loop (lines 55–68): **inner `try/catch` at line 56**
  - On error: logs + increments error counter + pushes to errors array
  - **Does NOT re-throw** — batch continues with remaining meters
  - Failed meter errors are included in the return value summary but never surface as a job-level failure

### Gap 3: Multi-Layer Silent Swallow

| Layer         | Location                          | What is lost                                                       |
| ------------- | --------------------------------- | ------------------------------------------------------------------ |
| Outer         | `scheduled.ts:43-44`              | Any error from the whole sync job — returns 200 to Cloudflare      |
| Batch         | `cron-sync.ts:59-67`              | Per-meter errors — batch continues; only logged                    |
| API fallbacks | `tuya-http.ts:361, 390, 462, 534` | Errors from each fallback endpoint — returns `null`, falls through |

The fallback chain in `getDeviceConsumption()` (`tuya-http.ts:563-600`) tries 4–5 endpoints. Intermediate failures are silently discarded until all are exhausted, at which point `TUYA_READING_UNAVAILABLE` is thrown — but that throw is then caught by the per-target loop in `cron-sync.ts`.

### Gap 4: No "Fetched-At" Timestamp on Readings

**`supabase/migrations/20260527120000_energy_domain_schema.sql:32-42`** — `consumption_readings` table

Timestamps present:

- `recorded_at` TIMESTAMPTZ NOT NULL — set from `snapshot.recordedAt`
- `created_at` TIMESTAMPTZ NOT NULL DEFAULT `now()` — DB insertion time

**`src/lib/services/tuya-http.ts:564`**: `const recordedAt = new Date();` — this is the **current time when the cron job runs**, not a timestamp from Tuya's response. For fallback statistics endpoints, times are floored to day/month boundaries.

**There is no field that records "when was this data actually fetched from the Tuya API."** If Tuya serves stale cached data, or if the local timestamp check says fresh while Tuya returns old data, there is no way to detect it.

## Code References

- `src/lib/services/tuya-client.ts:23-34` — `isAccessTokenExpired()` and `TOKEN_REFRESH_SKEW_MS`
- `src/lib/services/tuya-client.ts:102-122` — `resolveAccessToken()` orchestrator
- `src/lib/services/tuya-client.ts:255-275` — `listLinkedUserDevices()` — calls `resolveAccessToken(forceRefresh=false)`
- `src/lib/services/tuya-client.ts:314-337` — `syncMeterReading()` — main sync entry
- `src/lib/services/tuya-http.ts:126-143` — `parseTuyaResponse()` — throws on bad status/code
- `src/lib/services/tuya-http.ts:223-271` — `signedRequest()` — no 401 catch-and-retry
- `src/lib/services/tuya-http.ts:293-305` — `refreshAccessToken()` — GET `/v1.0/token/{refreshToken}`
- `src/lib/services/tuya-http.ts:361, 390, 462, 534` — fallback endpoint try/catches — swallow errors, return `null`
- `src/lib/services/tuya-http.ts:563-600` — `getDeviceConsumption()` fallback chain
- `src/lib/services/tuya-errors.ts:28-60` — `mapTuyaProviderError()` — code → error type mapping
- `src/lib/services/cron-sync.ts:35-77` — `runBatchTuyaSync()` — per-target loop with inner catch
- `src/scheduled.ts:16-46` — `runScheduledJob()` — outer catch swallows all errors
- `supabase/migrations/20260528120000_tuya_oauth_tokens_and_readings_idempotency.sql:7-18` — token table schema
- `supabase/migrations/20260527120000_energy_domain_schema.sql:32-42` — readings table schema

## Architecture Insights

**What R3 is actually testing against:**

The risk "token expires silently" has two distinct failure modes that Phase 3 tests must separately cover:

1. **Timestamp-detectable expiry** — `isAccessTokenExpired()` returns true → `resolveAccessToken()` calls `refreshAccessToken()`. This path exists and works, but can be broken if `refreshAccessToken()` itself fails (expired refresh token, network error). Those failures are swallowed.

2. **Tuya-server-detected expiry** — Token looks fresh locally (within the 60s window) but Tuya returns error code 1010/28841002. There is no catch-and-retry here; the error propagates up and is swallowed at `scheduled.ts:43`.

The "stale-reading detection" requirement from the test plan means: **when either of the above failure modes occurs, the system must surface a clear error, not silently write nothing or return success-shaped output.**

**Cheapest test layer (confirming test-plan.md §2 R3 guidance):**

- _Unit test_: `isAccessTokenExpired()` with `it.each` fixture table — oracle on `TOKEN_REFRESH_SKEW_MS`. Already-established pattern from `consumption-window.test.ts`.
- _Integration test_: Insert expired `tuya_oauth_tokens` row → call `syncMeterReading()` with mocked HTTP → assert either (a) `refreshAccessToken()` was called and token row updated, or (b) error surfaced to caller — not swallowed.

## What Phase 3 Tests Need to Cover (Grounded in Code)

Based on the test-plan.md R3 guidance "what would prove protection":

> An expired or invalid Tuya token triggers a refresh attempt or surfaces a clear error — not silent stale data.

Mapped to actual code:

| Scenario                                           | Code path to exercise                                                                   | What to assert                                                                           |
| -------------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Token expired by timestamp                         | `resolveAccessToken()` (tuya-client.ts:102) detects expiry via `isAccessTokenExpired()` | `refreshAccessToken()` called; new token saved to `tuya_oauth_tokens`; sync succeeds     |
| Refresh succeeds → sync runs                       | Full `syncMeterReading()` path after forced refresh                                     | `consumption_readings` row created with `recorded_at` ≈ now                              |
| Refresh fails (refresh token expired / Tuya error) | `refreshAccessToken()` returns error                                                    | Error is **not** swallowed — surfaces from `runBatchTuyaSync()` with explicit error code |
| Token looks fresh locally but Tuya returns 1010    | `parseTuyaResponse()` throws `TUYA_TOKEN_EXPIRED`                                       | Same — error not swallowed (this may require a code fix before the test can pass)        |

**Anti-pattern to avoid** (test-plan.md §2): Mocking Tuya client with always-valid token; asserting only that sync ran, not that data is fresh.

## Test Infrastructure Available (Phase 1–2 Reuse)

### Already set up — no changes needed

- **`vitest.config.ts:8-38`** — `astro:env/server` shim for node pool; all Tuya env vars exported (lines 25-34)
- **`vitest.workers.config.ts:38-68`** — same shim for Workers pool, sourced from `cloudflare:test` env
- **`vitest.workers.config.ts:83-92`** — miniflare bindings, compatibility date/flags
- **`vitest.setup.ts:1-27`** — `.env.test` loaded into `process.env` before workers spin up
- **`package.json:6-8`** — `npm test` already runs both node + workers pools

### Copy-paste patterns from Phase 1–2

| Pattern                              | Source                                              | Adapt for Phase 3                                                                    |
| ------------------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Oracle-first `it.each` fixtures      | `consumption-window.test.ts:7-50`                   | Swap window bounds for token expiry timestamps + `TOKEN_REFRESH_SKEW_MS` boundary    |
| Hoisted `vi.mock()` at module level  | `breach-notifications-idempotency.test.ts:7-11`     | Mock `@/lib/services/tuya-http` or `@/lib/services/tuya-client` at the HTTP boundary |
| `beforeAll`/`afterAll` user creation | `breach-notifications-idempotency.test.ts:71-95`    | Add `tuya_oauth_tokens` insert after user creation                                   |
| `beforeEach` FK fixture chain        | `breach-notifications-idempotency.test.ts:97-131`   | Insert `meters` + `tuya_oauth_tokens` (expired token fixture)                        |
| Mock reset + per-test override       | `breach-notifications-idempotency.test.ts:134, 146` | Control `refreshAccessToken` behavior per test case                                  |
| Untyped Supabase client              | `breach-notifications-idempotency.test.ts:61-66`    | Same — no generated `Database` type                                                  |
| Real DB assertion after job          | `breach-notifications-idempotency.test.ts:155-162`  | Query `tuya_oauth_tokens` for updated token, `consumption_readings` for new row      |

### One change needed in `vitest.workers.config.ts`

**`vitest.workers.config.ts:77`** — current glob: `src/lib/services/__tests__/breach-notifications*.test.ts`

Must expand to include Phase 3 integration test files. Suggested:

```
src/lib/services/__tests__/(breach-notifications|tuya-token|tuya-sync)*.test.ts
```

Or broadened to `src/lib/services/__tests__/**/*.test.ts` if preferred.

### Token fixture shape (for `tuya_oauth_tokens` inserts)

From `src/lib/services/tuya-client.ts:72-81` (`toTokenInsert()`):

```ts
{
  user_id: string,
  access_token: string,
  refresh_token: string,
  access_token_expires_at: ISO string,  // set to now() - 120s for "expired" fixture
  refresh_token_expires_at: null,
  tuya_uid: string,
}
```

## Historical Context (from prior changes)

- `context/changes/test-infra-breach-to-email/` — Phase 1: bootstrapped Vitest + Workers pool; established the hoisted-mock + real-Supabase pattern that Phase 3 reuses wholesale.
- `context/changes/window-boundary-idempotency/` — Phase 2: oracle-first `it.each` unit tests + predicate-operator recording builder; both patterns directly applicable to token-expiry boundary tests.

## Open Questions

1. **Should Phase 3 fix the silent-swallow at `scheduled.ts:43` as part of the phase, or only write tests that document the current (broken) behavior?** The test-plan guidance says "stale-reading detection surfaces an error, not silent success" — this implies a code change is in scope, not just a test that passes against the existing swallow.

2. **Token-invalid-but-locally-fresh path** (Gap 1 above): A test for the Tuya-1010 case requires the sync to actually propagate the error. Currently it is swallowed. This path likely needs a small code change (catch `TUYA_TOKEN_EXPIRED` in `syncMeterReading()` and force-retry once) before a meaningful test can be written.

3. **`refresh_token_expires_at` validation**: Is checking this in scope for Phase 3? It's a real gap but lower priority than the two scenarios above. Could be a Phase 3 stretch goal or punted to Phase 4.

4. **`created_at` as a stale-data proxy**: While there is no `fetched_at` field, `created_at` (DB insertion time) is always now(). If sync runs but the same `recorded_at` value appears again with a newer `created_at`, it implies Tuya returned a cached/stale timestamp. This could be the basis for stale-detection without a schema change — worth confirming with the team.
