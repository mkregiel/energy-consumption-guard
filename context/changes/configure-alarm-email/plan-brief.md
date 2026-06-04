# Configure Alarm Email (S-04) — Plan Brief

> Full plan: `context/changes/configure-alarm-email/plan.md`

## What & Why

Users currently have no way to set the email address that receives breach notifications. The `notification_settings` table exists and the Resend dispatch pipeline (F-04) is live, but it silently skips every breach because no UI or API exists to populate `alarm_email`. This change fills that gap.

## Starting Point

The `notification_settings` table is in production with RLS policies in place. `src/types.ts` exports `NotificationSettings`. S-03 (configure consumption limit) delivered the exact pattern to follow: API → hook → component → dashboard wiring.

## Desired End State

A user on the dashboard sees an "Alarm email" form card below the consumption limit form. They enter or update their email address and save it. The saved address is immediately used for future breach notifications, completing the US-01 end-to-end alarm flow.

## Key Decisions Made

| Decision       | Choice                                     | Why (1 sentence)                                                                    |
| -------------- | ------------------------------------------ | ----------------------------------------------------------------------------------- |
| Placement      | Below limit form on dashboard              | No new routing needed; alarm settings co-located with limit settings.               |
| Delete/clear   | Out of scope                               | Matches DB NOT NULL constraint; opt-out is a separate future slice.                 |
| Validation     | Zod email() server + matching client check | Consistent with /api/limits; server is authoritative, client gives inline feedback. |
| Feedback UX    | Green 4-second banner (same as limit form) | Direct reuse of existing ConsumptionLimitForm pattern.                              |
| HTTP semantics | Always upsert (POST only)                  | Mirrors /api/limits; user_id PK makes upsert idiomatic.                             |

## Scope

**In scope:** `/api/notifications` GET/POST endpoint, `notification-settings-service.ts`, `useNotificationSettingsUpsert` hook, `AlarmEmailForm` component, dashboard wiring.

**Out of scope:** Delete/clear email, timezone picker, test-email send, separate settings page.

## Architecture / Approach

Vertical slice mirroring S-03 exactly. No DB migrations. Three phases: API → hook + component → dashboard wiring.

```
dashboard.astro (server fetch)
  └─ AlarmEmailForm (client:load)
       └─ useNotificationSettingsUpsert hook
            └─ POST /api/notifications
                 └─ notification-settings-service.ts
                      └─ notification_settings table (RLS, upsert on user_id)
```

## Phases at a Glance

| Phase               | What it delivers                               | Key risk                                                        |
| ------------------- | ---------------------------------------------- | --------------------------------------------------------------- |
| 1. API Endpoint     | GET/POST /api/notifications, service layer     | None — direct mirror of /api/limits                             |
| 2. Hook + Component | AlarmEmailForm UI with validation and feedback | Polish error messages must match existing conventions           |
| 3. Dashboard Wiring | Form visible and pre-filled on dashboard load  | Server-side fetch must handle null (no settings row) gracefully |

**Prerequisites:** Feature branch `feature/configure-alarm-email` checked out; Supabase local dev running (schema already migrated).  
**Estimated effort:** ~1 session across 3 phases.

## Open Risks & Assumptions

- Assumes the authenticated Supabase client (not service-role) is sufficient for upsert — RLS allows `user_id = auth.uid()` writes.
- If a user has a breach event before saving an email, they simply receive no notification — no retroactive send needed.

## Success Criteria (Summary)

- User can save an alarm email from the dashboard and see a green confirmation banner
- Saved email is used for subsequent breach notifications (verifiable via GET /api/notifications)
- No regression in the existing consumption limit form
