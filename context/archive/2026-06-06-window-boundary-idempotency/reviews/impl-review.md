<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Window boundary + idempotency tests

- **Plan**: context/changes/window-boundary-idempotency/plan.md
- **Scope**: All 4 phases
- **Date**: 2026-06-06
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical 3 warnings 4 observations

## Verdicts

| Dimension           | Verdict                                                                     |
| ------------------- | --------------------------------------------------------------------------- |
| Plan Adherence      | WARNING                                                                     |
| Scope Discipline    | PASS                                                                        |
| Safety & Quality    | WARNING                                                                     |
| Architecture        | PASS                                                                        |
| Pattern Consistency | PASS                                                                        |
| Success Criteria    | WARNING (tests passed at sha 70af182; node_modules not present in worktree) |

## Findings

### F1 — Tautological half-open interval semantics tests

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/**tests**/consumption-window.test.ts:65–75
- **Detail**: All three assertions were mathematical tautologies (value compared to itself). Provided zero regression signal regardless of what getWindowBounds() returned.
- **Fix**: Replaced with cross-boundary assertions using oracle-derived UTC values from the fixture table.
- **Decision**: FIXED

### F2 — Static integration test email causes re-run failures

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/**tests**/breach-notifications-idempotency.test.ts:71
- **Detail**: `createUser` with static email `test-idempotency@example.com` throws on re-run if previous afterAll didn't execute.
- **Fix**: Added cleanup guard at top of beforeAll — lists users, finds by email, deletes if found before createUser.
- **Decision**: FIXED

### F3 — `--passWithNoTests` changes gate semantics

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: package.json (test script)
- **Detail**: Unplanned flag makes `npm test` exit 0 when no test files match, masking misconfigured patterns.
- **Fix B**: Kept `--passWithNoTests` on `test` script for dev/bootstrap use; added `test:ci` script without the flag as the strict CI gate.
- **Decision**: FIXED via Fix B

### F4 — vitest.config.ts shim missing PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: vitest.config.ts (astro-env-server-shim plugin)
- **Detail**: Shim exported `SUPABASE_URL`/`SUPABASE_KEY` instead of planned `PUBLIC_SUPABASE_URL`/`PUBLIC_SUPABASE_ANON_KEY`. Future tests importing services that use those names without mocking would get `undefined` silently.
- **Fix**: Added the two planned names as additional exports in the shim.
- **Decision**: FIXED

### F5 — .env.test loaded via globalSetup instead of planned envFile option

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: vitest.config.ts:globalSetup / vitest.setup.ts
- **Detail**: Plan specified envFile/dotenv; actual uses globalSetup. Works now but could break if worker parallelism or setupFiles are added.
- **Fix**: Added explanatory comment in vitest.config.ts documenting the approach and the migration note.
- **Decision**: FIXED

### F6 — change.md status is `implemented`, not `done`

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: context/changes/window-boundary-idempotency/change.md:4
- **Detail**: Phase 4 plan specified `status: done`; actual was `status: implemented`.
- **Fix**: Updated to `status: done`.
- **Decision**: FIXED

### F7 — currentMonthStartWarsaw() uses a fragile DST heuristic

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/**tests**/breach-notifications-idempotency.test.ts:17–56
- **Detail**: Two-pass offset heuristic can yield wrong value on DST transition days. `getWindowBounds()` already computes this correctly.
- **Fix**: Replace helper body with `return getWindowBounds("month", "Europe/Warsaw", new Date()).windowStart.toISOString()`
- **Decision**: SKIPPED
