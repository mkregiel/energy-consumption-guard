<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Dezaktywacja monitoringu metera

- **Plan**: context/changes/tuya-detach-device/plan.md
- **Scope**: All phases (1-3 of 3)
- **Date**: 2026-06-28
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 1 observation

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

### F1 — MeterInsert type now requires status field

- **Severity**: WARNING
- **Impact**: LOW
- **Dimension**: Pattern Consistency
- **Location**: src/types.ts:18
- **Detail**: MeterInsert = Omit<Meter, "id" | "created_at" | "updated_at"> included status as required after adding status to Meter. The upsert never passes status (DB defaults to 'active').
- **Fix**: Omit status from MeterInsert.
- **Decision**: FIXED

### F2 — Missing GRANT in recreated RPC function

- **Severity**: WARNING
- **Impact**: LOW
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260628120000_meter_status.sql
- **Detail**: Migration re-creates get_eligible_sync_targets() without GRANT EXECUTE TO service_role. PostgreSQL preserves grants on CREATE OR REPLACE, but original migration includes it explicitly.
- **Fix**: Added GRANT EXECUTE statement.
- **Decision**: FIXED

### F3 — 401 test bypasses makeCtx helper

- **Severity**: OBSERVATION
- **Impact**: LOW
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/**tests**/meter-status-endpoint.test.ts:44
- **Detail**: The 401 test uses a minimal { locals: { user: null } } context instead of makeCtx. This is a deliberate workaround for a Response realm mismatch in Vitest when vi.mock is combined with dynamic imports — makeCtx causes the 401 to return 200 due to instanceof Response failing across realms.
- **Fix**: N/A — the minimal context is the correct workaround.
- **Decision**: SKIPPED (intentional workaround)
