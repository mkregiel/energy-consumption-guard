---
date: 2026-06-29T12:00:00+02:00
researcher: Claude
git_commit: 385e2610ee6842bbeba1da61fa5df7308df89faa
branch: claude/reverent-gauss-c3f122
repository: 10xdev
topic: "Meter limit system — full overview for delete-meter-limit change"
tags: [research, codebase, limits, consumption-limits, delete]
status: complete
last_updated: 2026-06-29
last_updated_by: Claude
---

# Research: Meter Limit System Overview

**Date**: 2026-06-29  
**Researcher**: Claude  
**Git Commit**: 385e2610ee6842bbeba1da61fa5df7308df89faa  
**Branch**: claude/reverent-gauss-c3f122  
**Repository**: 10xdev (MeterMind)

## Research Question

Full overview of the meter limit system — data model, API, UI, and prior changes — to inform the "delete-meter-limit" change.

## Summary

The limit system lets each user configure **one consumption limit** (threshold in kWh over a day/week/month window). Background crons evaluate limits hourly, create breach events, and send email alerts. The system currently supports **create and update only** — there is no delete endpoint, no delete service function, and no delete button in the UI. The DB schema already has RLS DELETE policies on `consumption_limits` and cascade delete on `limit_breach_events`, so the data layer is ready for deletion.

## Detailed Findings

### Data Model

**`consumption_limits`** — one row per user

- `id` UUID PK, `user_id` UUID FK → `auth.users` (UNIQUE), `threshold_kwh` NUMERIC (>0), `window_type` TEXT ('day'|'week'|'month'), `timezone` TEXT (default 'Europe/Warsaw'), `created_at`, `updated_at`
- File: `supabase/migrations/20260527120000_energy_domain_schema.sql:19-30`

**`limit_breach_events`** — breach history per limit

- `limit_id` UUID FK → `consumption_limits` (**ON DELETE CASCADE**), `user_id`, `breached_at`, `window_start` (idempotency key), `consumption_kwh`, `notified_at`, `notification_attempt_count`, `notification_failed_at`
- Unique index: `(limit_id, window_start)` WHERE `window_start IS NOT NULL`
- File: `supabase/migrations/20260527120000_energy_domain_schema.sql:51-60`

**RLS policies** — all four CRUD policies exist on `consumption_limits` requiring `user_id = auth.uid()`, including DELETE. Same for `limit_breach_events`.

- File: `supabase/migrations/20260527120000_energy_domain_schema.sql:105-241`

**Key implication**: Deleting a `consumption_limits` row will cascade-delete all its `limit_breach_events`. RLS already permits the owning user to delete.

### API Layer

**`src/pages/api/limits/index.ts`**

- `GET /api/limits` — returns user's limit or null
- `POST /api/limits` — upserts limit (threshold_kwh + window_type)
- **No DELETE handler** — this is the gap to fill

### Service Layer

**`src/lib/services/limit-service.ts`**

- `getUserLimit(supabase, userId)` — SELECT single limit
- `upsertUserLimit(supabase, userId, payload)` — UPSERT with `onConflict: "user_id"`
- **No delete function** exists

**`src/lib/services/limit-evaluation.ts`**

- `runLimitEvaluation(supabase)` — loads all `consumption_limits`, evaluates each against consumption in its window, inserts breach events
- Already handles "no limit" case (skips users without limits)

**`src/lib/services/limit-consumption-preview.ts`**

- `getLimitWindowPreview(supabase, meterId, limit)` — sums readings in current window for UI display

**`src/lib/services/breach-notifications.ts`**

- `runBreachNotifications(supabase)` — sends email alerts for unnotified breaches
- Joins on `consumption_limits` — if limit is deleted, cascade removes breach events, so no orphaned notifications

### UI Layer

**`src/components/limits/ConsumptionLimitForm.tsx`** (156 lines)

- Form with threshold input + window_type dropdown + save button
- Consumption preview bar (green/amber/red progress)
- Uses `useLimitUpsert()` hook → POST /api/limits
- **No delete button or remove action**
- Polish UI text ("Zapisz limit" = Save limit)

**`src/pages/dashboard.astro`**

- Fetches limit via `getUserLimit()`, renders `<ConsumptionLimitForm>` with preview props
- All limit UI lives on the dashboard — no separate limit page

**`src/components/hooks/useLimitUpsert.ts`**

- Client hook for POST /api/limits with error handling
- No corresponding `useLimitDelete` hook exists

**`src/components/limits/limit-labels.ts`**

- Window type labels: day→"Doba", week→"Tydzień", month→"Miesiąc"

### TypeScript Types

**`src/types.ts`**

- `ConsumptionLimit` interface (id, user_id, threshold_kwh, window_type, timezone, timestamps)
- `LimitBreachEvent` interface
- `WindowType = "day" | "week" | "month"`

## Code References

- `supabase/migrations/20260527120000_energy_domain_schema.sql:19-30` — consumption_limits table
- `supabase/migrations/20260527120000_energy_domain_schema.sql:51-60` — limit_breach_events table (CASCADE)
- `supabase/migrations/20260527120000_energy_domain_schema.sql:105-241` — RLS policies (DELETE included)
- `src/pages/api/limits/index.ts` — GET/POST endpoints (no DELETE)
- `src/lib/services/limit-service.ts` — getUserLimit, upsertUserLimit (no delete)
- `src/lib/services/limit-evaluation.ts` — runLimitEvaluation (handles missing limits)
- `src/lib/services/limit-consumption-preview.ts` — getLimitWindowPreview
- `src/lib/services/breach-notifications.ts` — runBreachNotifications
- `src/components/limits/ConsumptionLimitForm.tsx` — form UI (no delete button)
- `src/components/hooks/useLimitUpsert.ts` — upsert hook
- `src/pages/dashboard.astro` — dashboard rendering limit form

## Architecture Insights

1. **One limit per user** — enforced by UNIQUE constraint on `user_id`, not per-meter. Deleting means the user has no limit at all until they create a new one.
2. **Cascade delete is already wired** — `limit_breach_events.limit_id` has `ON DELETE CASCADE`, so deleting a limit auto-cleans breach history.
3. **Cron jobs are deletion-safe** — `runLimitEvaluation` queries all limits; if none exist for a user, that user is simply skipped. No special handling needed.
4. **Preview depends on limit existing** — `getLimitWindowPreview` is only called when `limit !== null` (dashboard.astro:67-74), so deletion won't cause preview errors.
5. **Pattern to follow** — the existing meter API (`src/pages/api/meters/`) supports DELETE; the limit API should mirror that pattern.

## Historical Context (from prior changes)

- `context/archive/2026-06-04-configure-consumption-limit/` — S-03 implementation: GET/POST /api/limits, ConsumptionLimitForm, upsert service. Established the current API pattern.
- `context/archive/2026-05-31-background-limit-evaluation/` — F-03: hourly cron evaluating limits. Already handles "no limit" gracefully.
- `context/archive/2026-06-06-window-boundary-idempotency/` — Breach event idempotency via `(limit_id, window_start)` unique index.
- `context/archive/2026-06-04-email-alarm-on-limit-breach/` — S-05: E2E verification of full alarm pipeline.
- `context/foundation/roadmap.md` — FR-003 (one limit per config) is must-have; FR-006 (multiple limits) deferred to v2.

## Open Questions

1. **UI pattern for delete** — Should the delete button be inside `ConsumptionLimitForm` (next to save), or a separate danger-zone section? The meter deactivation change (c413c40) may offer a pattern.
2. **Confirmation UX** — Delete is destructive (cascade-deletes breach history). Should there be a confirmation dialog?
3. **Notification settings** — When a limit is deleted, should `notification_settings.alarm_email` be cleared too, or left intact for future limits?
4. **E2E test scope** — Does this change need E2E tests, or is the API + unit layer sufficient?
