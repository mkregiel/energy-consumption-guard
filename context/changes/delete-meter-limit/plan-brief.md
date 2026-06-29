# Delete Meter Limit — Plan Brief

> Full plan: `context/changes/delete-meter-limit/plan.md`
> Research: `context/changes/delete-meter-limit/research.md`

## What & Why

Users can currently set and update a consumption limit but cannot remove it. This change adds a delete path through all layers so a user can remove their limit with a single click, resetting the dashboard form to its empty state.

## Starting Point

The limit system is fully built for create/read/update: `consumption_limits` table with RLS (including DELETE policy), `limit_breach_events` with `ON DELETE CASCADE`, GET/POST API, service functions, and a dashboard form. The DB layer is already deletion-ready — no migration needed.

## Desired End State

A "Usuń limit" button appears in the limit form when a limit is configured. Clicking it immediately deletes the limit, cascade-deletes breach history, and resets the form to empty. The alarm email is preserved. Background cron jobs continue working (they skip users without limits).

## Key Decisions Made

| Decision                      | Choice                                | Why (1 sentence)                                                               | Source   |
| ----------------------------- | ------------------------------------- | ------------------------------------------------------------------------------ | -------- |
| Confirmation UX               | No confirmation — direct delete       | User preference for simplicity; limit can be re-created instantly.             | Plan     |
| Post-delete behavior          | Reset form to empty state (no reload) | Instant feedback, user can immediately set a new limit.                        | Plan     |
| Alarm email on delete         | Keep intact                           | Avoids friction if user sets a new limit later; inert without an active limit. | Plan     |
| Testing scope                 | Unit tests for service + API only     | Covers new code paths; UI is simple enough for manual verification.            | Plan     |
| Notification settings cleanup | Not needed                            | Cascade delete handles breach events; alarm email is independent.              | Research |

## Scope

**In scope:**

- `deleteUserLimit()` service function
- `DELETE /api/limits` endpoint
- `useLimitDelete` client hook
- Delete button in `ConsumptionLimitForm`
- Unit tests for service and API

**Out of scope:**

- Confirmation dialog
- Clearing alarm email on delete
- E2E / Playwright tests
- DB migration (not needed)
- Changes to cron jobs (already handle missing limits)

## Architecture / Approach

Mirrors the existing upsert pattern: service function → API handler → client hook → UI button. The delete button appears only when `initialLimit` is not null. On success, form state resets client-side to the "no limit" visual state. Cascade delete in the DB handles breach history cleanup automatically.

## Phases at a Glance

| Phase       | What it delivers                                              | Key risk                                            |
| ----------- | ------------------------------------------------------------- | --------------------------------------------------- |
| 1. Backend  | `deleteUserLimit` service + `DELETE /api/limits` + unit tests | Low — follows existing patterns exactly             |
| 2. Frontend | `useLimitDelete` hook + delete button with form reset         | Low — UI state management for null→empty transition |

**Prerequisites:** None — DB layer is already deletion-ready.
**Estimated effort:** ~1 session across 2 phases.

## Open Risks & Assumptions

- Cascade delete is irreversible — breach history is permanently lost (acceptable per user's choice of no confirmation)
- Assumes the form component can manage the null-limit transition client-side without a page reload

## Success Criteria (Summary)

- User can delete their limit with one click and the form resets to empty
- Breach history is automatically cleaned up
- Setting a new limit after deletion works normally
