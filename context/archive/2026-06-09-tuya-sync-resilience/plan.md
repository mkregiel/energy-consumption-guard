# Tuya Sync Resilience Implementation Plan

## Overview

Phase 3 of the test rollout (`context/foundation/test-plan.md` §3). Adds unit tests
proving token-expiry detection is correct, fixes two production silent-failure paths,
then adds integration tests that verify the full token-refresh-and-sync flow and the
no-stale-write guarantee. Covers risk R3: _Tuya OAuth token expires silently → readings
stop → limit never evaluated → no alarm fires._

## Current State Analysis

- `isAccessTokenExpired()` (`tuya-client.ts:23-34`) checks expiry proactively with a
  60-second skew constant but has zero test coverage.
- `syncMeterReading()` (`tuya-client.ts:314-337`) calls `resolveAccessToken()` before
  making API calls but does not catch a Tuya error-code 1010 response and retry with a
  forced refresh (the "token looks fresh locally but server says invalid" path).
- `runBatchTuyaSync()` (`cron-sync.ts:35-77`) catches per-meter errors and returns them
  in an `errors` array; config/DB errors propagate as throws.
- `runScheduledJob()` (`scheduled.ts:16-46`) has a blanket outer catch that logs and
  **swallows** everything, including the fatal throws from `runBatchTuyaSync()`.
- `refresh_token_expires_at` is stored in `tuya_oauth_tokens` but never read.
- No unit or integration tests exist for any of these paths.
- Test infrastructure (node and Workers pools, env shimming, real-Supabase fixture
  lifecycle) is fully set up from Phases 1–2.

## Desired End State

After this phase:

- `isAccessTokenExpired()` has an oracle-first unit test covering the skew boundary, the
  `forceRefresh` flag, and an explicit `.todo` documenting the never-checked refresh-token
  field.
- `syncMeterReading()` catches `TUYA_TOKEN_EXPIRED` / `TUYA_AUTH_FAILED` from Tuya API
  calls, force-refreshes the token, and retries once.
- `runScheduledJob()` re-throws errors propagated from `runBatchTuyaSync()` so Cloudflare
  observes the failure.
- Integration tests prove: expired token → refresh fires → token row updated → reading
  written; and failed refresh → `errors` array non-empty → no reading written.

### Key Discoveries

- `TOKEN_REFRESH_SKEW_MS = 60_000` (`tuya-client.ts:23`) is the boundary constant the
  unit test must exercise.
- `mapTuyaProviderError()` (`tuya-errors.ts:28-60`) maps Tuya codes 1010 / 28841002 →
  `TUYA_TOKEN_EXPIRED` and codes 1004 / 1107 / 1109 / 28841003 → `TUYA_AUTH_FAILED` —
  the retry catch must cover both.
- `runBatchTuyaSync()` already surfaces per-meter errors via its return value; only the
  outer `scheduled.ts` catch needs fixing to re-throw what `runBatchTuyaSync()` throws.
- Workers pool glob (`vitest.workers.config.ts:77`) currently matches only
  `breach-notifications*.test.ts`; must be widened before new integration-test files are
  picked up.
- All Tuya env vars are already exported from both pool shims (`vitest.config.ts:25-34`
  and `vitest.workers.config.ts:54-65`); no new env shimming needed.

## What We're NOT Doing

- Adding a `fetched_at` column to `consumption_readings` — stale-data detection is
  covered by asserting no row is written on failure.
- Adding `refresh_token_expires_at` validation code — gap is documented as a `.todo`
  test only.
- Changing the per-meter loop behavior in `cron-sync.ts` — per-meter errors continue to
  be caught, counted, and returned; only fatal errors now re-throw from `scheduled.ts`.
- Testing Cloudflare cron observability (what Cloudflare shows for re-thrown errors) —
  deployment concern outside this phase.

## Implementation Approach

Phase 1 is purely additive (new test file, node pool) and can land independently. Phase
2 fixes two production paths that Phase 3's integration tests depend on to pass. Phase 3
adds the Workers-pool integration test file and expands the pool glob to pick it up.

## Critical Implementation Details

**Error type matching in the retry catch**: The retry guard in `syncMeterReading()` must
check for `TUYA_TOKEN_EXPIRED` and `TUYA_AUTH_FAILED` specifically (confirm the exact
property name on `TuyaServiceError` from `tuya-errors.ts` before writing). A broad
`catch (error)` without a type guard would force-refresh on network errors, retrying in
the wrong failure mode.

**One retry only**: The catch-and-retry must not recurse or loop. Retry the original API
call exactly once with the fresh token; if the second attempt throws, re-throw
immediately.

**`scheduled.ts` catch scope**: Per-meter errors are already consumed inside
`runBatchTuyaSync()` and never reach the outer catch. Only fatal throws reach it. The
fix is a one-line addition: add `throw error` after the existing `console.error` call.

---

## Phase 1: Token Expiry Unit Tests

### Overview

Create `tuya-token-refresh.test.ts` in the node pool. Covers `isAccessTokenExpired()`
with an oracle-first fixture table and documents the `refresh_token_expires_at` gap as
a `.todo`. No production changes; this phase is independently shippable.

### Changes Required

#### 1. New unit test file

**File**: `src/lib/services/__tests__/tuya-token-refresh.test.ts`

**Intent**: Test `isAccessTokenExpired()` from `tuya-client.ts:23-34` with an
oracle-first `it.each` fixture table, deriving all expected values from
`TOKEN_REFRESH_SKEW_MS` and calendar math before running the function. Follow the pattern
from `consumption-window.test.ts:7-50`.

**Contract**: Fixture rows must cover at minimum:

| Scenario                                         | Expected |
| ------------------------------------------------ | -------- |
| Token expires in 120 s → outside 60-second skew  | `false`  |
| Token expires in 59 s → inside skew              | `true`   |
| Token expires in exactly 60 s → at skew boundary | `true`   |
| Token expired 1 s ago                            | `true`   |
| Token valid for 10 min but `forceRefresh=true`   | `true`   |

One additional `.todo` test (no body) with description:
`"should surface an error when refresh_token_expires_at has passed — resolveAccessToken() currently never reads this field"`

The test imports only from `@/lib/services/tuya-client`. No Supabase or HTTP mocking
needed.

### Success Criteria

#### Automated Verification

- Unit tests pass: `npx vitest run --config vitest.config.ts`
- TypeScript compilation clean: `npx tsc --noEmit`

#### Manual Verification

- Confirm the `.todo` test appears in test-run output as "pending", not "failed".

**Implementation Note**: After automated verification passes, confirm the `.todo`
appearance manually before proceeding to Phase 2.

---

## Phase 2: Production Code Fixes

### Overview

Fix two silent-failure paths that prevent Phase 3 integration tests from asserting the
desired behavior. No new test files. Must land before Phase 3.

### Changes Required

#### 1. Catch-and-retry for server-side token expiry in `syncMeterReading()`

**File**: `src/lib/services/tuya-client.ts`

**Intent**: On the user-OAuth path, after the Tuya API call to fetch the consumption
snapshot, catch a `TuyaServiceError` whose code is `TUYA_TOKEN_EXPIRED` or
`TUYA_AUTH_FAILED`. On that catch: call `resolveAccessToken()` with `forceRefresh=true`
for the same user, then repeat the API call exactly once with the refreshed token. If the
second call also throws, re-throw immediately.

**Contract**: The retry guard applies **only to the user-OAuth branch** (skip for the
cloud-config branch which uses a project token). The function's return type and behavior
on any non-token error must remain unchanged.

#### 2. Re-throw fatal errors from `runScheduledJob()`

**File**: `src/scheduled.ts`

**Intent**: In the outer `catch` block (currently lines 43-44), add `throw error` after
the existing `console.error` call so fatal errors from `runBatchTuyaSync()` (config
missing, DB unreachable) propagate to the Cloudflare Worker runtime.

**Contract**: One-line addition. Per-meter errors are caught inside `runBatchTuyaSync()`
and never reach this outer catch, so this change has no effect on the common per-meter
failure path.

### Success Criteria

#### Automated Verification

- TypeScript compilation clean: `npx tsc --noEmit`
- Existing tests still pass: `npm test`

#### Manual Verification

- Trigger a manual sync with a deliberately missing Tuya config env var (e.g., unset
  `TUYA_CLIENT_ID` locally); confirm the Worker logs a thrown error rather than a silent
  success.

**Implementation Note**: Pause for manual confirmation of the misconfiguration test
before proceeding to Phase 3.

---

## Phase 3: Integration Tests + Config

### Overview

Add a Workers-pool integration test file covering the full token-refresh-and-sync flow.
Expand the Workers-pool glob to pick it up. After this phase, R3 has end-to-end test
coverage and Phase 3 status is `shipped`.

### Changes Required

#### 1. Expand Workers pool test glob

**File**: `vitest.workers.config.ts`

**Intent**: Line 77 currently matches only `breach-notifications*.test.ts`. Expand it
to also match `tuya-token-sync.test.ts`.

**Contract**: Replace the current glob string with:

```
src/lib/services/__tests__/{breach-notifications,tuya-token-sync}*.test.ts
```

#### 2. New Workers-pool integration test file

**File**: `src/lib/services/__tests__/tuya-token-sync.test.ts`

**Intent**: Four integration tests using the same fixture lifecycle as
`breach-notifications-idempotency.test.ts` — hoisted `vi.mock`, `beforeAll` user
creation with admin client, `beforeEach` FK inserts, `afterEach`/`afterAll` cleanup. Real
Supabase test DB. Mock the Tuya HTTP transport at the network boundary only
(the `tuya-http` module or equivalent); do not mock internal modules.

**Contract**: The four test cases:

**T1 — Expired token → refresh fires → sync completes**

- Fixture: user + expired `tuya_oauth_tokens` row
  (`access_token_expires_at` = now − 120 s) + meter
- Mock: `refreshAccessToken` resolves with a valid new token;
  `getDeviceConsumption` resolves with a reading snapshot
- Call: `syncMeterReading(supabase, client, userId, { meterId })`
- Assert: `tuya_oauth_tokens.access_token` updated in DB;
  `consumption_readings` row created with `recorded_at` ≈ now

**T2 — Token looks fresh locally but Tuya returns 1010 → retry succeeds**

- Fixture: user + fresh `tuya_oauth_tokens` row (expires in 10 min) + meter
- Mock: first `getDeviceConsumption` call rejects with
  `new TuyaServiceError({ code: 'TUYA_TOKEN_EXPIRED' })`; `refreshAccessToken`
  resolves; second `getDeviceConsumption` call resolves with a reading snapshot
- Assert: `refreshAccessToken` called exactly once;
  `consumption_readings` row created

**T3 — Both refresh attempts fail → errors non-empty + no reading written**

- Fixture: user + expired token + meter
- Mock: `refreshAccessToken` rejects with an error
- Call: `runBatchTuyaSync(supabase)`
- Assert: return value `errors` array is non-empty;
  `consumption_readings` has no new row for this meter

**T4 — Fatal config error re-throws from `runScheduledJob()`**

- Setup: mock `getTuyaConfig` (or the env binding) to throw a config-missing error
- Call: `runScheduledJob(mockController)`
- Assert: `await expect(runScheduledJob(...)).rejects.toThrow()`

`tuya_oauth_tokens` fixture insert shape (use untyped Supabase client —
`breach-notifications-idempotency.test.ts:61-66` pattern):

```
{ user_id, access_token, refresh_token,
  access_token_expires_at: <ISO string>,
  refresh_token_expires_at: null, tuya_uid: "test-uid" }
```

#### 3. Update test-plan Phase 3 status

**File**: `context/foundation/test-plan.md`

**Intent**: Mark Phase 3 row as `shipped` in §3 table and set the Change-folder column
to `context/changes/tuya-sync-resilience`.

### Success Criteria

#### Automated Verification

- Workers-pool tests pass: `npx vitest run --config vitest.workers.config.ts`
- Full test suite passes: `npm test`
- TypeScript compilation clean: `npx tsc --noEmit`

#### Manual Verification

- Run `npm test` twice consecutively and confirm both passes (idempotency — no leftover
  DB rows from a previous run).
- After T3 (failed sync), directly query `consumption_readings` and confirm no row for
  the test meter was inserted.

---

## Testing Strategy

### Unit Tests (Phase 1)

- `isAccessTokenExpired()` boundary: 5-row `it.each` table
- `.todo` for refresh-token-expiry gap

### Integration Tests (Phase 3)

- T1: happy-path token refresh end-to-end
- T2: server-side 1010 catch-and-retry
- T3: double failure → no stale write
- T4: fatal config error propagation

### Manual Testing

- Phase 2: deliberate misconfiguration surfaces non-200 / thrown error
- Phase 3: `npm test` passes twice (idempotency); T3 DB assertion confirmed

## Migration Notes

No database migrations. All changes are new test files or logic-only edits to existing
production files.

## References

- Related research: `context/changes/tuya-sync-resilience/research.md`
- Token expiry logic: `src/lib/services/tuya-client.ts:23-34`
- Token refresh orchestrator: `src/lib/services/tuya-client.ts:102-122`
- Sync orchestrator: `src/lib/services/cron-sync.ts:35-77`
- Error mapping: `src/lib/services/tuya-errors.ts:28-60`
- Scheduled entry: `src/scheduled.ts:16-46`
- Integration test pattern: `src/lib/services/__tests__/breach-notifications-idempotency.test.ts`
- Unit test pattern: `src/lib/services/__tests__/consumption-window.test.ts`
- Workers pool config: `vitest.workers.config.ts:77`
- Test-plan Phase 3: `context/foundation/test-plan.md` §3

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step
> lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Token Expiry Unit Tests

#### Automated

- [x] 1.1 Unit tests pass: `npx vitest run --config vitest.config.ts` — d3da9fe
- [x] 1.2 TypeScript compilation clean: `npx tsc --noEmit` — d3da9fe

#### Manual

- [x] 1.3 `.todo` test appears in output as pending, not failed — d3da9fe

### Phase 2: Production Code Fixes

#### Automated

- [x] 2.1 TypeScript compilation clean: `npx tsc --noEmit` — 1262cb7
- [x] 2.2 Existing tests still pass: `npm test` — 1262cb7

#### Manual

- [x] 2.3 Sync with missing config env var surfaces thrown error (not silent success) — 1262cb7

### Phase 3: Integration Tests + Config

#### Automated

- [x] 3.1 Workers-pool tests pass: `npx vitest run --config vitest.workers.config.ts` — d219d37
- [x] 3.2 Full test suite passes: `npm test` — d219d37
- [x] 3.3 TypeScript compilation clean: `npx tsc --noEmit` — d219d37

#### Manual

- [x] 3.4 `npm test` passes twice consecutively (idempotency) — d219d37
- [x] 3.5 After T3, direct DB query confirms no `consumption_readings` row for test meter — d219d37
