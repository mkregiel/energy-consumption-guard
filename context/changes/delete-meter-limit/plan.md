# Delete Meter Limit Implementation Plan

## Overview

Add the ability for users to delete their consumption limit. Currently the limit system only supports create/update (upsert). This change adds a DELETE path through all layers: service function, API endpoint, client hook, and a delete button in the existing form that resets to the empty state on success.

## Current State Analysis

The limit system is fully built out for create, read, and update:

- **DB**: `consumption_limits` table with RLS DELETE policy already in place; `limit_breach_events` has `ON DELETE CASCADE` on `limit_id`
- **API**: `GET /api/limits` and `POST /api/limits` exist in `src/pages/api/limits/index.ts`
- **Service**: `getUserLimit()` and `upsertUserLimit()` in `src/lib/services/limit-service.ts`
- **UI**: `ConsumptionLimitForm.tsx` with `useLimitUpsert` hook — no delete button

### Key Discoveries:

- RLS DELETE policy on `consumption_limits` already allows `user_id = auth.uid()` — no migration needed
- `limit_breach_events.limit_id` has `ON DELETE CASCADE` — breach history auto-cleans
- `runLimitEvaluation()` already handles users with no limit (skips them)
- `getLimitWindowPreview()` is only called when `limit !== null` — no preview errors after delete
- Meter deactivation (commit c413c40) established the destructive-action UI pattern in `MeterRegistrationForm.tsx`

## Desired End State

A user who has a configured consumption limit can click a "Usuń limit" (Delete limit) button in the dashboard form. The limit is immediately deleted (no confirmation dialog), the form resets to empty fields, and the consumption preview bar disappears. Breach history is cascade-deleted. The alarm email setting is preserved for future use.

**Verification**: After deleting, `GET /api/limits` returns `{ limit: null }`. Re-visiting the dashboard shows the empty limit form. Background cron jobs skip the user. Setting a new limit works normally.

## What We're NOT Doing

- No confirmation dialog — user chose direct delete for simplicity
- Not clearing `notification_settings.alarm_email` on limit delete — it stays for future limits
- Not adding E2E tests — unit tests for service + API only
- No new migration — DB is already ready
- Not changing the limit evaluation or breach notification cron jobs — they already handle missing limits

## Implementation Approach

Mirror the existing upsert pattern across all layers. Add `deleteUserLimit()` to the service, a `DELETE` handler to the API endpoint, a `useLimitDelete` hook, and a delete button in `ConsumptionLimitForm` that resets form state on success.

---

## Phase 1: Backend — Service + API + Tests

### Overview

Add the delete service function and API endpoint, then write unit tests covering both.

### Changes Required:

#### 1. Delete service function

**File**: `src/lib/services/limit-service.ts`

**Intent**: Add `deleteUserLimit(supabase, userId)` that deletes the user's consumption limit row. Mirrors the pattern of `upsertUserLimit` — Supabase query, error check, throw `TuyaServiceError` on failure.

**Contract**: `export async function deleteUserLimit(supabase: SupabaseClient, userId: string): Promise<void>` — deletes from `consumption_limits` where `user_id` matches. No return value needed.

#### 2. DELETE API handler

**File**: `src/pages/api/limits/index.ts`

**Intent**: Add a `DELETE` export following the exact same auth-guard + supabase-init + try/catch + tuyaErrorResponse pattern as the existing GET and POST handlers. No request body validation needed.

**Contract**: `export const DELETE: APIRoute` — calls `deleteUserLimit(supabase, userOrResponse.id)`, returns `apiJsonSuccess(200, {})`.

#### 3. Unit tests for delete service

**File**: `src/lib/services/__tests__/limit-service.test.ts` (new file, or extend if exists)

**Intent**: Test that `deleteUserLimit` calls supabase `.delete().eq("user_id", ...)` and throws on error. Follow the testing patterns from other service test files in `src/lib/services/__tests__/`.

**Contract**: Test cases: successful delete, supabase error → throws TuyaServiceError.

#### 4. Unit tests for DELETE endpoint

**File**: `src/pages/api/limits/__tests__/limits-delete.test.ts` (new file)

**Intent**: Test the DELETE handler: unauthorized → 401, successful delete → 200, service error → error response. Mirror the test structure from existing API endpoint tests.

**Contract**: Test cases: missing auth → returns error, valid auth → calls deleteUserLimit → returns `{ ok: true }`, service throws → returns error response.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npx vitest run src/lib/services/__tests__/limit-service`
- API tests pass: `npx vitest run src/pages/api/limits/__tests__/limits-delete`
- Type checking passes: `npx tsc --noEmit` (ignoring pre-existing astro:\* errors)

#### Manual Verification:

- `curl -X DELETE /api/limits` with valid auth cookie returns 200
- After delete, `GET /api/limits` returns `{ limit: null }`
- Breach events for the deleted limit are gone from the database

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Frontend — Hook + UI

### Overview

Add the client-side delete hook and a delete button in the consumption limit form that resets the form to its empty state on success.

### Changes Required:

#### 1. Delete hook

**File**: `src/components/hooks/useLimitDelete.ts` (new file)

**Intent**: Create a hook mirroring `useLimitUpsert` — manages `isDeleting` and `errorMessage` state, calls `DELETE /api/limits`, returns success/failure. Follow the same fetch + response parsing + Polish error translation pattern.

**Contract**: `export function useLimitDelete(): { deleteLimit: () => Promise<boolean>; isDeleting: boolean; errorMessage: string | null; }` — returns `true` on success, `false` on failure.

#### 2. Delete button in form

**File**: `src/components/limits/ConsumptionLimitForm.tsx`

**Intent**: When `initialLimit` is not null (user has an existing limit), render a "Usuń limit" button. On click, call `deleteLimit()` from the hook. On success, reset local form state (`thresholdKwh`, `windowType`) to defaults and clear the limit reference so the preview bar disappears and the form shows as empty.

**Contract**: The delete button renders only when a limit exists. Uses red/destructive styling (`text-red-400 hover:text-red-300` or similar — match the codebase's color conventions). No confirmation dialog. Shows a loading spinner while deleting (same spinner pattern as the save button). On success, the component transitions to the "no limit" visual state.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx tsc --noEmit` (ignoring pre-existing astro:\* errors)
- No lint errors in modified files

#### Manual Verification:

- Dashboard shows "Usuń limit" button when a limit exists
- Clicking the button deletes the limit and the form resets to empty
- The consumption preview bar disappears after delete
- The delete button is not visible when no limit is configured
- Setting a new limit after deletion works normally
- The alarm email is still configured after limit deletion

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `deleteUserLimit` service: successful delete, error handling
- `DELETE /api/limits` endpoint: auth check, success path, error path

### Manual Testing Steps:

1. Log in, configure a limit (if not already set)
2. Verify "Usuń limit" button appears
3. Click delete — form resets, preview bar disappears
4. Verify GET /api/limits returns null
5. Set a new limit — confirm it works
6. Verify alarm email setting is preserved
7. Check DB: breach events for old limit are gone

## References

- Related research: `context/changes/delete-meter-limit/research.md`
- Existing limit API: `src/pages/api/limits/index.ts`
- Existing limit service: `src/lib/services/limit-service.ts`
- Upsert hook pattern: `src/components/hooks/useLimitUpsert.ts`
- Limit form: `src/components/limits/ConsumptionLimitForm.tsx`
- Meter deactivation UI pattern: `src/components/tuya/MeterRegistrationForm.tsx:107-145`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Backend — Service + API + Tests

#### Automated

- [x] 1.1 Unit tests pass for deleteUserLimit service — 81befc4
- [x] 1.2 Unit tests pass for DELETE /api/limits endpoint — 81befc4
- [x] 1.3 Type checking passes — 81befc4

#### Manual

- [ ] 1.4 DELETE /api/limits returns 200 with valid auth
- [ ] 1.5 GET /api/limits returns null after delete
- [ ] 1.6 Breach events cascade-deleted from database

### Phase 2: Frontend — Hook + UI

#### Automated

- [x] 2.1 Type checking passes
- [x] 2.2 No lint errors in modified files

#### Manual

- [ ] 2.3 Delete button visible only when limit exists
- [ ] 2.4 Click delete resets form and hides preview bar
- [ ] 2.5 Setting a new limit after deletion works
- [ ] 2.6 Alarm email preserved after limit deletion
