<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Test Infra (Workers Pool) + Breach-to-Email

- **Plan**: context/changes/test-infra-breach-to-email/plan.md
- **Scope**: All phases (1–3 of 3)
- **Date**: 2026-06-08
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 3 observations (5 triaged)

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Findings

### F1 — finally cleanup of breach2Id can mask test failures

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency / Safety & Quality
- **Location**: breach-notifications-idempotency.test.ts ~line 226
- **Detail**: If the delete inside finally throws, that exception replaces the original assertion failure. All other cleanup lives in afterEach.
- **Fix**: Wrap the finally delete in try/catch so cleanup errors are swallowed.
- **Decision**: FIXED — try/catch added around the finally delete.

### F2 — Mock error comment claims "exact shape" but real Resend body is JSON

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: breach-notifications-idempotency.test.ts ~line 200
- **Detail**: Comment said "exact error shape email-client.ts:27 produces" but real Resend 422 body is JSON. Test logic is correct regardless.
- **Fix**: Changed comment to "same format as" with a note that the exact string doesn't matter.
- **Decision**: FIXED

### F3 — Factory mockResolvedValue(undefined) is dead code

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: breach-notifications-idempotency.test.ts line 8–11
- **Detail**: beforeEach calls mockReset() before any test, so the factory's mockResolvedValue is never visible.
- **Fix**: Removed .mockResolvedValue(undefined) from the factory; beforeEach owns the default.
- **Decision**: FIXED

### F4 — .mock.calls.length instead of not.toHaveBeenCalled()

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: breach-notifications-idempotency.test.ts line 172
- **Detail**: Pre-existing code; .mock.calls.length works but not.toHaveBeenCalled() is idiomatic Vitest.
- **Fix**: N/A
- **Decision**: SKIPPED

### F5 — vitest.workers.config.ts has implicit coupling to vitest.setup.ts

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: vitest.workers.config.ts line 81
- **Detail**: Removing vitest.setup.ts silently breaks the Supabase admin client with no parse-time error.
- **Fix**: Expanded comment to name the dependency explicitly.
- **Decision**: FIXED
