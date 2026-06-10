<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Transactional Email Alerts

- **Plan**: context/changes/transactional-email-alerts/plan.md
- **Scope**: Full plan (Phases 1–4)
- **Date**: 2026-06-02
- **Verdict**: NEEDS ATTENTION → triage fixes applied
- **Findings**: 0 critical, 4 warnings, 1 observation

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Findings

### F1 — `.env.example` duplicate Resend entries

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `.env.example:18-19`
- **Detail**: Plan Phase 1 required commented placeholders only (L7–9). Lines 18–19 add uncommented empty `RESEND_API_KEY=` / RESEND_FROM_EMAIL=` duplicates.
- **Fix**: Remove lines 18–19; keep only the commented block at L7–9.
- **Decision**: FIXED (user approach — comments on all uncommented entries; removed duplicate Resend block)

### F2 — Misleading "templated" wording in change Notes

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `context/changes/transactional-email-alerts/change.md:11`
- **Detail**: Notes say "send templated alarm emails" but plan explicitly excludes HTML/React Email templates; implementation is plain-text only.
- **Fix**: Change Notes to "send plain-text alarm emails".
- **Decision**: FIXED

### F3 — Email sent but `notified_at` update failure leaves row re-eligible

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/services/breach-notifications.ts`
- **Detail**: After successful `sendPlainTextEmail`, a failed `notified_at` update throws into the outer catch without incrementing attempt count. Breach stays eligible → duplicate email on next cron run.
- **Fix A ⭐ Recommended**: After send success, retry the `notified_at` update 2–3 times with short delay; if still failing, increment attempt count with `NOTIFICATION_MARK_FAILED`.
- **Decision**: FIXED via Fix A

### F4 — No guard against concurrent duplicate sends

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/services/breach-notifications.ts`
- **Detail**: Two workers can SELECT the same breach, both send, both UPDATE without `.is("notified_at", null)` guard.
- **Fix**: Conditional update `.is("notified_at", null)` on mark path; no-op if already notified.
- **Decision**: FIXED

### F5 — N+1 `notification_settings` queries per breach

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/lib/services/breach-notifications.ts`
- **Detail**: Separate settings query inside the breach loop vs batch pattern in `limit-evaluation.ts`.
- **Fix**: Pre-load settings with `.in("user_id", uniqueUserIds)` into a `Map` before the loop.
- **Decision**: FIXED

## Triage summary

| Finding | Outcome                         |
| ------- | ------------------------------- |
| F1      | FIXED (comments on all entries) |
| F2      | FIXED                           |
| F3      | FIXED via Fix A                 |
| F4      | FIXED                           |
| F5      | FIXED                           |
