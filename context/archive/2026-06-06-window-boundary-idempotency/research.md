---
date: 2026-06-06T00:00:00+02:00
researcher: Mariusz Kręgiel
git_commit: 5098970afcb6da41024fab6fc79df3356fd56ca9
branch: claude/sharp-goodall-d19b6a
repository: energy-consumption-guard
topic: "Window boundary + idempotency"
tags: [research, codebase, limit-evaluation, breach-notifications, consumption-window, idempotency]
status: complete
last_updated: 2026-06-06
last_updated_by: Mariusz Kręgiel
---

# Research: Window boundary + idempotency

**Date**: 2026-06-06T00:00:00+02:00
**Researcher**: Mariusz Kręgiel
**Git Commit**: 5098970afcb6da41024fab6fc79df3356fd56ca9
**Branch**: claude/sharp-goodall-d19b6a
**Repository**: energy-consumption-guard

## Research Question

Phase 2 test plan (R2 + R4): Where does window boundary arithmetic live, what is the exact boundary semantics, and how does the dispatch job prevent duplicate emails for the same breach window?

## Summary

**Window boundary (R4):** Calendar-based (day/week/month start in user timezone), computed at runtime by `getWindowBounds()` in `src/lib/services/consumption-window.ts`. Boundary is start-inclusive / end-exclusive (`recorded_at >= window_start AND recorded_at < window_end`) applied consistently across all three query paths (preview JS sum, evaluation DB RPC, evaluation query). Timezone is currently hardcoded to `"Europe/Warsaw"` at MVP.

**Idempotency (R2):** Three-layer defence: (1) DB partial unique index `(limit_id, window_start)` ensures at most one breach event row per calendar window; (2) dispatch job fetches only rows where `notified_at IS NULL AND notification_failed_at IS NULL`; (3) the `markBreachNotified` update uses `.is("notified_at", null)` as a conditional write. A **race window exists**: two concurrent cron runs that fetch the same row before either writes `notified_at` will both send an email. This gap is application-level, not DB-level.

## Detailed Findings

### Window boundary arithmetic (`src/lib/services/consumption-window.ts`)

- **`getWindowBounds(windowType, timezone, referenceDate?)`** (line 92) returns `{ windowStart: Date, windowEnd: Date }`.
- `day`: `window_start` = midnight of current local date; `window_end` = midnight of next local day (lines 100–105).
- `week`: `window_start` = midnight of the most recent ISO Monday; `window_end` = midnight 7 days later (lines 107–114).
- `month`: `window_start` = midnight of the 1st of the current calendar month; `window_end` = midnight of the 1st of next month (lines 117–120).
- All variants are **calendar-based**, not rolling.
- `referenceDate` defaults to `new Date()` — evaluated at cron fire time.

### Timezone source

- `src/lib/services/limit-service.ts:27`: timezone is hardcoded to `"Europe/Warsaw"` on limit creation (`// MVP: hardcoded per plan; S-04 can add a timezone picker`).
- The value is stored on the `consumption_limits` row and passed into `getWindowBounds` at evaluation time — so existing rows carry the timezone they were created with.

### Filtering predicate — consistent across all sites

All three query paths use the same half-open interval `[window_start, window_end)`:

| Site                | File:line                                                                              | Predicate                                                             |
| ------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Preview (JS sum)    | `src/lib/services/limit-consumption-preview.ts:27–28`                                  | `.gte("recorded_at", windowStartIso).lt("recorded_at", windowEndIso)` |
| Evaluation (DB RPC) | `supabase/migrations/20260531193000_limit_breach_events_window_start_unique.sql:40–41` | `recorded_at >= p_window_start AND recorded_at < p_window_end`        |
| Evaluation query    | `src/lib/services/limit-evaluation.ts:106–107`                                         | same `.gte` / `.lt`                                                   |

**Oracle for tests:** A reading with `recorded_at = window_start` is **included**. A reading with `recorded_at = window_end` is **excluded**.

### Consumption field

`kwh_delta` (`NUMERIC`) on the `consumption_readings` table — defined in `supabase/migrations/20260527120000_energy_domain_schema.sql:37`. Summed by JS `reduce` in preview (`limit-consumption-preview.ts:35`) and by `COALESCE(SUM(kwh_delta), 0)` in the DB RPC.

### Two sum paths (lessons.md prior)

- **Preview** (`limit-consumption-preview.ts:21–22`): fetches all `kwh_delta` rows for the window and sums in TypeScript. Comment documents this as intentional MVP approach; follow-up is DB aggregate.
- **Evaluation** (`limit-evaluation.ts`): calls the DB RPC `sum_meter_consumption_in_window` — already DB-aggregate.

The lessons.md rule ("prefer DB aggregate over JS reduce") is already implemented in the evaluation path; only the preview path carries the MVP caveat.

### Idempotency — breach event insertion (`src/lib/services/limit-evaluation.ts`)

- **Application-level existence check** (lines 123–137): before inserting, the code selects by `(limit_id, window_start)`. If a row is found, it returns `"skipped"` without touching the DB.
- **Plain `.insert()`** (line 141–152), not `.upsert()`. Comment at lines 139–140: _"PostgREST cannot use the partial unique index on `(limit_id, window_start)` for `ON CONFLICT`."_
- **DB partial unique index** (`supabase/migrations/20260531193000_limit_breach_events_window_start_unique.sql:6–8`):
  ```sql
  CREATE UNIQUE INDEX limit_breach_events_limit_id_window_start_unique
    ON public.limit_breach_events (limit_id, window_start)
    WHERE window_start IS NOT NULL;
  ```
  This is the hard guarantee: one breach row per `(limit_id, window_start)` window.

### Idempotency — email dispatch (`src/lib/services/breach-notifications.ts`)

- **Fetch query** (lines 130–135): only rows where `notified_at IS NULL AND notification_failed_at IS NULL` are candidates.
- **`markBreachNotified`** (lines 94–100): sets `notified_at = nowIso` with `.is("notified_at", null)` guard — the UPDATE is a no-op if another run beat it.
- **Retry / terminal failure**: `notification_attempt_count` increments on each failure (line 52–54); at `>= 3` (`MAX_NOTIFICATION_ATTEMPTS`, line 15) sets `notification_failed_at`, permanently excluding the row.
- **Race window (open risk):** If two cron runs fetch the same unnotified row before either completes the send+write cycle, both will call `sendPlainTextEmail`. The conditional update prevents a third call but cannot prevent the second. This is a known application-level gap with no DB-level exclusive lock.

## Code References

- [`src/lib/services/consumption-window.ts:92`](src/lib/services/consumption-window.ts) — `getWindowBounds` — all window boundary logic
- [`src/lib/services/limit-consumption-preview.ts:21–35`](src/lib/services/limit-consumption-preview.ts) — preview JS-sum path + MVP comment
- [`src/lib/services/limit-evaluation.ts:106–152`](src/lib/services/limit-evaluation.ts) — evaluation RPC call + select-then-insert guard + timezone/window use
- [`src/lib/services/breach-notifications.ts:15,52–100,130–135`](src/lib/services/breach-notifications.ts) — dispatch job: fetch filter, attempt counter, `markBreachNotified`
- [`src/lib/services/limit-service.ts:27`](src/lib/services/limit-service.ts) — hardcoded timezone note
- [`supabase/migrations/20260531193000_limit_breach_events_window_start_unique.sql:6–8,37–41`](supabase/migrations/20260531193000_limit_breach_events_window_start_unique.sql) — partial unique index + `sum_meter_consumption_in_window` RPC
- [`supabase/migrations/20260527120000_energy_domain_schema.sql:37`](supabase/migrations/20260527120000_energy_domain_schema.sql) — `kwh_delta` column definition
- [`supabase/migrations/20260602120000_limit_breach_notification_retry.sql:4`](supabase/migrations/20260602120000_limit_breach_notification_retry.sql) — `notification_attempt_count` column

## Architecture Insights

1. **Window type is user-configured, timezone is MVP-hardcoded.** `window_type` comes from the `consumption_limits` row (user choice). Timezone is always `"Europe/Warsaw"` for now — tests should use this timezone explicitly.

2. **Two sum paths, one window formula.** Both the preview and evaluation services call the same `getWindowBounds()`. A bug in `getWindowBounds` would affect both paths simultaneously. The oracle for boundary tests must come from the calendar semantics documented above, not from reading the output of either service.

3. **Idempotency is defence-in-depth but has a concurrent-run gap.** The unique index prevents duplicate breach rows (strong). The `notified_at` guard prevents re-sends in sequential runs (strong). But two concurrent dispatch runs can both read an unnotified row and send before either writes — a race condition that sequential integration tests will not catch. Test doubles that simulate a second run should invoke the job twice sequentially (not concurrently); the concurrent gap is a known accepted risk at MVP cron cadence.

4. **`notification_failed_at` is a terminal state.** Once set, a breach event is permanently excluded from dispatch. Tests that exercise the retry path must reset or not set this field.

## Historical Context (from prior changes)

- [`context/changes/background-limit-evaluation/change.md`](../background-limit-evaluation/change.md) — Documents the handoff contract: "Idempotency for email delivery uses `notified_at`, not duplicate `limit_breach_events`." Confirms select-then-insert approach and the `(limit_id, window_start)` unique index as a deploy prerequisite.
- [`context/changes/transactional-email-alerts/change.md`](../transactional-email-alerts/change.md) — Houses the email-alarm implementation; breach-notifications service lives here.

## Related Research

No prior `research.md` artifacts exist in `context/changes/` — this is the first research document in the project.

## Open Questions

1. **Concurrent dispatch race:** Two simultaneous cron runs can both fetch and send for the same breach event. At MVP cron cadence (`10 * * * *`) this is low-probability but not zero. Is the team aware and deliberately accepting it, or should the test plan document it as a known gap?

2. **`window_start` NULL rows:** The partial unique index only covers rows where `window_start IS NOT NULL`. Can `window_start` ever be NULL in a breach event? If so, are those rows safe to ignore or do they indicate a different failure mode?

3. **Preview vs evaluation sum divergence:** The preview service sums in JS; the evaluation service uses the DB RPC. If the JS reduce and the SQL `SUM(kwh_delta)` diverge (e.g., floating-point rounding on NUMERIC), a user could see a preview that does not match the evaluation threshold. Is this a risk worth a test?

4. **Timezone change mid-window:** If `"Europe/Warsaw"` timezone is eventually made configurable and a user changes it mid-month, `window_start` would shift. Existing breach events carry the old `window_start`. Is there a guard against this scenario?
