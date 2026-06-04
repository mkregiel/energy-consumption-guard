# Configure Alarm Email (S-04) Implementation Plan

## Overview

Add the Settings UI and API endpoint that lets users set their alarm email address in `notification_settings.alarm_email`. The breach notification pipeline (F-04) is already fully implemented — it just silently skips users who have no `notification_settings` row. This change closes that gap.

## Current State Analysis

The `notification_settings` table (migration `20260527120000`) has `user_id UUID PRIMARY KEY` and `alarm_email TEXT NOT NULL` with RLS policies restricting access to the owning user. The `NotificationSettings` TypeScript type exists in `src/types.ts:43`. Email dispatch is live in `src/lib/services/breach-notifications.ts` — it skips breaches with no settings row (`NO_NOTIFICATION_SETTINGS`). No API endpoint, hook, or UI component for this table exists today.

## Desired End State

A user visiting the dashboard sees an "Alarm email" form card below the consumption limit form. They can enter or update an email address and save it. The saved address is immediately used for future breach notifications. The form shows a 4-second green success banner on save and an inline error on failure.

### Key Discoveries:

- `/api/limits` (`src/pages/api/limits/index.ts`) is the direct model: GET returns row or null, POST upserts via `ON CONFLICT (user_id) DO UPDATE`, Zod validation, `requireUser()` auth guard, `apiJsonSuccess`/`apiJsonError` helpers
- `useLimitUpsert.ts` (`src/components/hooks/useLimitUpsert.ts`) is the hook model: `isSubmitting`, `errorMessage`, `handleSubmit`, Polish error messages for UNAUTHORIZED and VALIDATION_ERROR
- `ConsumptionLimitForm.tsx` (`src/components/limits/ConsumptionLimitForm.tsx`) is the component model: controlled form, 4-second `showSuccess` state, inline error display
- `dashboard.astro` (`src/pages/dashboard.astro:81`) already fetches `limit` server-side and passes to `ConsumptionLimitForm` — same pattern applies here
- `src/lib/services/limit-service.ts` provides the service layer model: `getUserLimit()` and `upsertUserLimit()`

## What We're NOT Doing

- No delete / clear email (user cannot opt out of notifications in this change — out of scope)
- No timezone picker (still hardcoded to Europe/Warsaw — separate future slice)
- No deliverability verification (sending a test email is out of scope)
- No separate `/settings` page — the form lives on the dashboard

## Implementation Approach

Three-phase vertical slice mirroring S-03 exactly: API → hook + component → dashboard wiring. No DB migrations needed.

## Phase 1: API Endpoint

### Overview

Create `GET/POST /api/notifications` following the `/api/limits` pattern. GET returns the current user's `notification_settings` row or `null`. POST upserts `alarm_email` using Supabase's `ON CONFLICT (user_id) DO UPDATE`.

### Changes Required:

#### 1. Notification settings service

**File**: `src/lib/services/notification-settings-service.ts`

**Intent**: Encapsulate the two Supabase queries (fetch and upsert) for `notification_settings`, keeping the API route thin — same separation as `limit-service.ts`.

**Contract**: Export `getUserNotificationSettings(supabase, userId): Promise<NotificationSettings | null>` and `upsertNotificationSettings(supabase, userId, alarmEmail: string): Promise<NotificationSettings>`. Both use the authenticated client passed in (not service role).

#### 2. API route

**File**: `src/pages/api/notifications/index.ts`

**Intent**: Expose `GET /api/notifications` (returns current settings or null) and `POST /api/notifications` (upserts alarm_email). Mirror `src/pages/api/limits/index.ts` structure exactly.

**Contract**:

- Both methods call `requireUser()` and return 401 on unauthenticated.
- POST body schema: `{ alarm_email: z.string().email() }` — Zod validates; on failure return `apiJsonError(400, 'VALIDATION_ERROR')`.
- GET response: `{ data: NotificationSettings | null }` via `apiJsonSuccess`.
- POST response: `{ data: NotificationSettings }` via `apiJsonSuccess`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- `GET /api/notifications` returns `null` for a user with no settings row
- `POST /api/notifications` with `{ alarm_email: "test@example.com" }` creates a row and returns it
- Second `POST` with a different email updates the existing row
- `POST` with an invalid email returns 400 with `VALIDATION_ERROR`
- `GET /api/notifications` without auth returns 401

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to Phase 2. Phase blocks use plain bullets — the corresponding `- [ ]` checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Hook and Component

### Overview

Create the React hook and form component following `useLimitUpsert` + `ConsumptionLimitForm` exactly. Polish UI language matches the existing limit form.

### Changes Required:

#### 1. Hook

**File**: `src/components/hooks/useNotificationSettingsUpsert.ts`

**Intent**: Manage the async POST to `/api/notifications`, expose `isSubmitting`, `errorMessage`, and `handleSubmit(alarmEmail)` — same shape as `useLimitUpsert`.

**Contract**: Export `useNotificationSettingsUpsert()` returning `{ isSubmitting: boolean, errorMessage: string | null, handleSubmit: (alarmEmail: string) => Promise<void> }`. Polish error messages: "Adres e-mail jest nieprawidłowy." for VALIDATION_ERROR, "Sesja wygasła. Zaloguj się ponownie." for UNAUTHORIZED, generic fallback "Wystąpił błąd. Spróbuj ponownie." for unknown errors.

#### 2. Form component

**File**: `src/components/notifications/AlarmEmailForm.tsx`

**Intent**: Render a single email input with a save button, 4-second green success banner on save, and an inline error message on failure — same visual structure as `ConsumptionLimitForm`.

**Contract**: Props: `interface AlarmEmailFormProps { initialAlarmEmail: string | null }`. The `showSuccess` state resets after 4000 ms (mirror the limit form). Email field is `type="email"` with `required`. On submit, call `handleSubmit` from the hook; on resolution without error set `showSuccess = true`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- Form renders with the current email pre-filled (or empty for first-time users)
- Saving a valid email shows the green banner for ~4 seconds
- Saving an invalid email shows an inline Polish error
- While submitting, the button is disabled/shows loading state

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human before proceeding to Phase 3.

---

## Phase 3: Dashboard Wiring

### Overview

Fetch `notification_settings` server-side in `dashboard.astro` and render `<AlarmEmailForm client:load>` below `<ConsumptionLimitForm>`.

### Changes Required:

#### 1. Server-side fetch in dashboard

**File**: `src/pages/dashboard.astro`

**Intent**: Fetch the authenticated user's notification settings alongside the existing limit fetch, and pass `initialAlarmEmail` to the new form component — same pattern as the existing `limit` fetch on line 81.

**Contract**: Add a call to `getUserNotificationSettings(supabase, user.id)` near the existing limit fetch. Pass `initialAlarmEmail={notificationSettings?.alarm_email ?? null}` to `AlarmEmailForm`.

#### 2. Render the form

**File**: `src/pages/dashboard.astro`

**Intent**: Mount `<AlarmEmailForm client:load initialAlarmEmail={...} />` below `<ConsumptionLimitForm>` in the dashboard layout.

**Contract**: Import `AlarmEmailForm` from `'../components/notifications/AlarmEmailForm'`. Place it in the same column/section as the limit form so alarm settings are co-located on the page.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification:

- Dashboard loads without errors for a user with no notification settings row (form shows empty)
- Dashboard loads with pre-filled email for a user with an existing settings row
- Saving a new email from the dashboard persists correctly (verify via GET /api/notifications)
- No regression in the consumption limit form above

**Implementation Note**: After completing this phase and all automated verification passes, pause here for final manual confirmation from the human.

---

## Testing Strategy

### Manual Testing Steps:

1. Log in as a user with no `notification_settings` row — confirm the form renders empty
2. Enter a valid email and save — confirm green banner, confirm row exists in DB
3. Reload the page — confirm email is pre-filled
4. Update the email and save — confirm row is updated (not duplicated)
5. Submit with an invalid email — confirm inline Polish error
6. Submit with auth expired — confirm "Sesja wygasła" error
7. Confirm `ConsumptionLimitForm` still works correctly (no regression)

## References

- Roadmap entry S-04: `context/foundation/roadmap.md`
- Model: S-03 plan: `context/changes/configure-consumption-limit/plan.md`
- Model: F-04 plan: `context/changes/transactional-email-alerts/plan.md`
- API model: `src/pages/api/limits/index.ts`
- Hook model: `src/components/hooks/useLimitUpsert.ts`
- Component model: `src/components/limits/ConsumptionLimitForm.tsx`
- Service model: `src/lib/services/limit-service.ts`
- DB table: `supabase/migrations/20260527120000_energy_domain_schema.sql`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: API Endpoint

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck`
- [x] 1.2 Linting passes: `npm run lint`

#### Manual

- [x] 1.3 GET /api/notifications returns null for user with no settings row
- [x] 1.4 POST with valid email creates/updates row and returns it
- [x] 1.5 POST with invalid email returns 400 VALIDATION_ERROR
- [x] 1.6 GET without auth returns 401

### Phase 2: Hook and Component

#### Automated

- [ ] 2.1 Type checking passes: `npm run typecheck`
- [ ] 2.2 Linting passes: `npm run lint`

#### Manual

- [ ] 2.3 Form renders with current email pre-filled (or empty)
- [ ] 2.4 Saving a valid email shows green banner for ~4 seconds
- [ ] 2.5 Saving an invalid email shows inline Polish error
- [ ] 2.6 Button is disabled/loading while submitting

### Phase 3: Dashboard Wiring

#### Automated

- [ ] 3.1 Type checking passes: `npm run typecheck`
- [ ] 3.2 Linting passes: `npm run lint`

#### Manual

- [ ] 3.3 Dashboard loads without errors for user with no notification settings
- [ ] 3.4 Dashboard loads with pre-filled email for user with existing settings
- [ ] 3.5 Saving email from dashboard persists correctly
- [ ] 3.6 No regression in ConsumptionLimitForm
