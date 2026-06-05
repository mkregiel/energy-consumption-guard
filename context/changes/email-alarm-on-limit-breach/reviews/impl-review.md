<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Email Alarm on Limit Breach

- **Plan**: `context/changes/email-alarm-on-limit-breach/plan.md`
- **Scope**: Phases 1–2 of 2 (full plan review)
- **Date**: 2026-06-04
- **Verdict**: NEEDS ATTENTION
- **Findings**: 1 critical · 3 warnings · 3 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | FAIL    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Findings

### F1 — Existing consumption_limit permanently overwritten without restore

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: `scripts/seed-test-breach.ts:186–204`
- **Detail**: When TEST_USER_ID already has a consumption_limits row, the script overwrites threshold_kwh → 0.01, window_type → 'day', timezone → 'Europe/Warsaw'. If --cleanup is not passed, the real user limit is permanently left at these test values with no warning. The cleanup path also deletes the pre-existing row (line 268) rather than restoring original values.
- **Fix A ⭐ Recommended**: Snapshot original values before overwriting, restore (not delete) on cleanup when the row pre-existed. Track `limitWasPreExisting`; in cleanup: UPDATE back to originals if pre-existing, DELETE if created by the script. Same pattern applies to meters (F2) and notification_settings (F2).
  - Strength: Zero data-loss risk; makes the script safe against the most common "forget --cleanup" scenario.
  - Tradeoff: ~10 extra lines; no architectural change.
  - Confidence: HIGH — meters and notification_settings cleanup have the same issue; fix pattern applies uniformly.
  - Blind spot: None significant.
- **Fix B**: Add a loud console.warn at the UPDATE site, document in README.
  - Strength: Minimal code change.
  - Tradeoff: Relies on the human to notice and manually restore; doesn't fix F2.
  - Confidence: MEDIUM — acceptable for an internal dev tool but leaves a footgun.
  - Blind spot: None significant.
- **Decision**: FIXED (Fix B) — Added console.warn showing original values before overwrite; select now fetches threshold_kwh/window_type/timezone for display.

### F2 — Cleanup deletes pre-existing meter and notification_settings rows

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `scripts/seed-test-breach.ts:272–281`
- **Detail**: If the test user already has a meter or notification_settings row before the script runs, --cleanup deletes those real rows. For meters, ON DELETE CASCADE would cascade-delete all real consumption_readings. For notification_settings, it silently removes the user's configured alarm email.
- **Fix**: Track `meterWasPreExisting` / `settingsWasPreExisting` flags. On cleanup: skip deletion if the row pre-existed; for notification_settings, restore the original alarm_email instead of deleting. (Same snapshot-or-restore pattern as F1.)
  - Strength: Closes all data-loss paths in the cleanup routine.
  - Tradeoff: A few more lines; no architectural change.
  - Confidence: HIGH — uniform fix pattern across all three tables.
  - Blind spot: Meter CASCADE behavior confirmed from schema.
- **Decision**: FIXED — Track meterWasPreExisting/originalAlarmEmail in SeedIds; cleanup skips meter deletion when pre-existing and restores original alarm_email instead of deleting the row.

### F3 — `source:'manual'` omitted from reading insert; DB default 'tuya' used

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `scripts/seed-test-breach.ts:210–212`
- **Detail**: The plan specified `source:'manual'` on the inserted reading. The field is omitted; the DB default is `'tuya'`. E2E behaviour is unaffected (evaluator sums kwh_delta regardless of source) but the test row is mislabelled as a Tuya reading.
- **Fix**: Add `source: "manual"` to the insert object on line 211.
- **Decision**: FIXED — Added `source: "manual"` to reading insert.

### F4 — Re-running without --cleanup on the same day leaves orphaned readings

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `scripts/seed-test-breach.ts:208–213`
- **Detail**: Each run inserts a new reading but only the current run's readingId is tracked. Prior readings are orphaned permanently. A second run on the same day will also see an existing breach for today's window_start and return "breached: 0", confusing testers expecting "breached: 1".
- **Fix**: Add a comment near seed() noting re-run limitations; or clean up all readings for the test meter/day on cleanup rather than just by readingId.
- **Decision**: FIXED — Added comment near reading insert noting re-run limitations and that --cleanup is required between same-day runs.

### F5 — Connectivity probe fetches all meters (no user_id filter)

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `scripts/seed-test-breach.ts:297`
- **Detail**: Probe URL has no user_id filter; service role bypasses RLS and touches all meters rows. Read-only so no corruption risk, but imprecise.
- **Fix**: Append `&user_id=eq.${env.TEST_USER_ID}` to the probe URL.
- **Decision**: FIXED — Added `&user_id=eq.${env.TEST_USER_ID}` filter to probe URL.

### F6 — `JSON.parse` in `triggerCron` throws on non-JSON 2xx response

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `scripts/seed-test-breach.ts:250`
- **Detail**: If a cron endpoint returns a 2xx with non-JSON body, JSON.parse throws a SyntaxError surfaced as "Unexpected token..." — misleading error message.
- **Fix**: Wrap in try/catch; fall back to logging the raw body string if JSON.parse fails.
- **Decision**: FIXED — Wrapped JSON.parse in try/catch; falls back to logging raw body on parse failure.
