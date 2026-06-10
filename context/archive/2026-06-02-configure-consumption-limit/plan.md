# Configure Consumption Limit Implementation Plan

## Overview

Implement roadmap slice S-03 (FR-003): authenticated API and dashboard UI so a user can set one energy consumption limit (kWh threshold + calendar window type). The background evaluator (F-03) already reads `consumption_limits`; this slice closes the configuration gap and adds in-window consumption preview with a progress bar aligned with F-03 window math.

## Current State Analysis

- **Schema:** `consumption_limits` with `UNIQUE (user_id)`, `threshold_kwh > 0`, `window_type IN ('day','week','month')`, default `timezone = 'Europe/Warsaw'` — `supabase/migrations/20260527120000_energy_domain_schema.sql`.
- **Types:** `ConsumptionLimit`, `WindowType` in `src/types.ts`; no `LimitUpsertPayload` yet.
- **Evaluation:** `src/lib/services/limit-evaluation.ts` sums via RPC `sum_meter_consumption_in_window` (service role only). Window boundaries from `src/lib/services/consumption-window.ts` (`getWindowBounds`).
- **API patterns:** `src/pages/api/meters/index.ts` — `requireUser`, zod `.strict()`, `apiJsonSuccess` / `apiJsonError`.
- **Dashboard:** `src/pages/dashboard.astro` — Tuya connect, meter form, consumption block (meter-gated). No limit section.
- **Gaps:** No `/api/limits`, no `limit-service`, no limit UI/hook. No toast library in repo.

### Key Discoveries

- F-03 and UI must share **calendar** window semantics (`getWindowBounds`) — already decided in planning.
- RPC aggregate is **not** callable from user session without a new migration; UI preview should sum via RLS-protected `consumption_readings` select + in-app sum (same formula as RPC: `COALESCE(SUM(kwh_delta), 0)`).
- One limit per user (FR-003 / FR-006 deferred); upsert on `user_id` only.

## Desired End State

A logged-in user on `/dashboard` configures `threshold_kwh` and `window_type` (day | week | month) in an always-visible inline form. On successful save, an inline success message appears without full page reload; form state reflects saved values. When a meter exists and readings fall in the current window, the section shows consumption in that window and a progress bar vs the threshold. `GET` and `POST /api/limits` return the standard `{ ok, data }` envelope. F-03 cron behavior unchanged but can be exercised end-to-end without Studio inserts.

### Verification

- Manual: set limit 5 kWh / day, sync readings, confirm preview sum and F-03 breach when sum > 5.
- Automated: `npm run lint`, `npm run build`.

## What We're NOT Doing

- Alarm email configuration (S-04) or breach email (S-05, F-04)
- Multiple limits per user (FR-006)
- DELETE / clear limit API
- Timezone picker (hardcode `Europe/Warsaw` on write)
- Rolling windows
- SQL migration unless a future review requires RPC grant for authenticated users
- Dedicated test infrastructure

## Implementation Approach

Mirror the meter slice: thin API routes, service layer for Supabase, React form with hook on dashboard. Reuse `getWindowBounds` for preview. Keep timezone as a server-side default on upsert. Progress bar is client-rendered from SSR props (limit + preview sum) refreshed after save via returned API payload or local state update.

## Critical Implementation Details

**Preview without meter:** Show the limit form always; hide progress bar and window sum when `meter === null` (optional copy: „Zarejestruj licznik, aby zobaczyć zużycie w oknie”).

**After save (no reload):** Hook returns saved `ConsumptionLimit`; component sets local limit state and toggles a dismissible success banner (~4s). Do not add a toast dependency for this slice alone.

**Week boundary:** Monday 00:00 in `Europe/Warsaw` — must not reimplement; import `getWindowBounds` from `consumption-window.ts`.

## Phase 1: API and limit service

### Overview

Expose `GET/POST /api/limits` and a service module for reading and upserting the user's single consumption limit row.

### Changes Required:

#### 1. Shared types

**File:** `src/types.ts`

**Intent:** Add request/response shapes for the limits API so routes and hooks share one contract.

**Contract:** `LimitUpsertPayload` with `threshold_kwh: number`, `window_type: WindowType` (no `timezone` in client payload — server sets `Europe/Warsaw`). Optional `LimitApiSuccess` wrapper types if mirroring meter/Tuya patterns.

#### 2. Limit service

**File:** `src/lib/services/limit-service.ts` (new)

**Intent:** Encapsulate Supabase access for limits, analogous to `meter-service.ts`.

**Contract:** `getUserLimit(supabase, userId): Promise<ConsumptionLimit | null>` — `maybeSingle` on `consumption_limits` filtered by `user_id`. `upsertUserLimit(supabase, userId, payload): Promise<ConsumptionLimit>` — upsert `{ user_id, threshold_kwh, window_type, timezone: 'Europe/Warsaw' }` with `onConflict: 'user_id'`, `.select().single()`. Map Supabase errors to `apiJsonError` via route (or throw generic `Error` with message — avoid `TuyaServiceError`).

#### 3. Limits API route

**File:** `src/pages/api/limits/index.ts` (new)

**Intent:** User-facing configuration endpoint protected like meters.

**Contract:** `export const prerender = false`. `GET`: `requireUser` → `createClient` → `getUserLimit` → `apiJsonSuccess(200, { limit })` where `limit` may be null. `POST`: parse JSON, zod schema:

- `threshold_kwh`: `z.coerce.number().positive()`
- `window_type`: `z.enum(['day','week','month'])`
- `.strict()`

Validation failures → `VALIDATION_ERROR` with `issues`. Success → `apiJsonSuccess(200, { limit })`. Same error codes as meters: `INVALID_JSON`, `SUPABASE_NOT_CONFIGURED`, `UNAUTHORIZED`.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- Unauthenticated `GET /api/limits` returns 401 JSON `UNAUTHORIZED`
- Authenticated `POST` with valid body creates/updates row in `consumption_limits`
- `POST` with `threshold_kwh: 0` or negative returns 400 `VALIDATION_ERROR`
- `GET` returns saved limit after POST

**Implementation Note:** Pause for manual confirmation before Phase 2.

---

## Phase 2: Window consumption preview helper

### Overview

Compute current-window consumption (kWh) for dashboard display using the same calendar bounds as F-03, without service-role RPC.

### Changes Required:

#### 1. Preview helper

**File:** `src/lib/services/limit-consumption-preview.ts` (new)

**Intent:** Provide SSR-friendly data for progress bar: sum in window, window bounds (for labels), and whether any readings exist in the window.

**Contract:** `getLimitWindowPreview(supabase, meterId, limit: ConsumptionLimit): Promise<{ consumptionKwh: number; windowStart: string; windowEnd: string; hasReadings: boolean }>`. Call `getWindowBounds(limit.window_type, limit.timezone)`. Query `consumption_readings` with `.eq('meter_id', meterId).gte('recorded_at', windowStartIso).lt('recorded_at', windowEndIso).select('kwh_delta')` (RLS applies). Sum `kwh_delta ?? 0` in TypeScript. `hasReadings`: at least one row returned. If no limit passed, caller skips (do not invoke).

#### 2. Optional: extend GET /api/limits

**File:** `src/pages/api/limits/index.ts`

**Intent:** Optional enhancement only if inline save should refresh preview without SSR — **default:** skip; SSR + local threshold update suffices for MVP. If implemented later, add query param `?includePreview=1` when meter exists.

**Contract:** Document in implementer notes: Phase 3 can refresh preview by updating `threshold_kwh` / `window_type` in client state and re-fetching preview via small `GET` extension — **not required** for initial slice if dashboard SSR runs on first load and save only changes limit fields (preview sum unchanged until sync/new readings).

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- With known readings in Supabase Studio, preview sum matches manual sum of `kwh_delta` in current calendar day (Europe/Warsaw)
- Empty window returns `consumptionKwh: 0`, `hasReadings: false`

**Implementation Note:** Pause for manual confirmation before Phase 3.

---

## Phase 3: Limit UI component and hook

### Overview

React form with inline editing, client validation, success banner, and progress bar when preview props are provided.

### Changes Required:

#### 1. Hook

**File:** `src/components/hooks/useLimitUpsert.ts` (new)

**Intent:** Client mutation for `POST /api/limits`, patterned on `useMeterUpsert.ts`.

**Contract:** `upsert(payload: LimitUpsertPayload): Promise<ConsumptionLimit | null>`. Client-side checks: positive threshold, window_type set. Parse `TuyaApiSuccess<{ limit: ConsumptionLimit }>` / `TuyaApiErrorBody` envelope (reuse types or alias as generic API success). Polish messages for `VALIDATION_ERROR`, `UNAUTHORIZED`. **No** `window.location.reload()` on success.

#### 2. Form component

**File:** `src/components/limits/ConsumptionLimitForm.tsx` (new)

**Intent:** Inline form: numeric input (kWh), select for window type (labels PL: „Doba”, „Tydzień”, „Miesiąc”). Submit calls hook.

**Contract:** Props: `initialLimit: ConsumptionLimit | null`, `preview: { consumptionKwh, thresholdKwh, hasReadings } | null` (null when no meter/limit). Progress bar: `min(100, (consumptionKwh / thresholdKwh) * 100)` when `thresholdKwh > 0`; color shift near/over 100% (e.g. amber/red via `cn()`). Success banner state after save. Styling: cosmic card (`rounded-2xl border border-white/10 bg-white/10 p-6 backdrop-blur-xl`), `FormField`, `ServerError`, `Button` from existing components.

#### 3. Window type labels

**File:** `src/components/limits/limit-labels.ts` (new, optional) or constants in form file

**Intent:** Single map `WindowType` → Polish label for select and summary text.

**Contract:** Export `WINDOW_TYPE_LABELS: Record<WindowType, string>`.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- Submit valid limit shows success banner without page reload
- Validation errors show on empty/invalid threshold
- Progress bar renders when preview props provided; hidden when `preview === null`

**Implementation Note:** Pause for manual confirmation before Phase 4.

---

## Phase 4: Dashboard integration

### Overview

Wire SSR data and place the limit section on the dashboard in the agreed order.

### Changes Required:

#### 1. Dashboard page

**File:** `src/pages/dashboard.astro`

**Intent:** Load limit and preview server-side; render `ConsumptionLimitForm` for all logged-in users.

**Contract:** After auth, call `getUserLimit(supabase, user.id)`. If `meter && limit`, call `getLimitWindowPreview(supabase, meter.id, limit)` and pass to form. Section order: header → `TuyaConnectCard` → **ConsumptionLimitForm** (`client:load`) → meter registration → consumption block (existing meter gate). Pass `preview: null` when no meter or no limit (form still works; bar hidden).

#### 2. README (minimal)

**File:** `README.md`

**Intent:** Document new user API route in energy domain section if such a list exists.

**Contract:** Add `GET/POST /api/limits` under protected routes alongside meters.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- Limit section visible before meter registration
- Full flow: connect Tuya → register meter → set limit → sync → progress bar updates on navigation/refresh (and threshold/window change updates bar denominator immediately)
- Sign out / sign in — limit persists

**Implementation Note:** Final manual sign-off for slice complete.

---

## Testing Strategy

### Unit Tests:

- Not in scope (no test runner per AGENTS.md).

### Integration Tests:

- Not in scope.

### Manual Testing Steps:

1. New user: set limit 10 kWh / week without meter — saves successfully.
2. Register meter, sync readings, refresh — preview sum and bar appear.
3. Lower threshold below current sum — bar at/over 100%; trigger F-03 evaluate cron — breach event created.
4. Change `window_type` to month — preview sum recalculates for new window (after refresh).
5. Invalid POST (0 kWh) — field/API error, no DB row change.

## Performance Considerations

Preview query loads all readings in the current window for one meter. Acceptable for MVP household scale; if month windows grow large, consider DB aggregate migration in a follow-up change.

## Migration Notes

No schema migration required. Existing `consumption_limits` RLS policies cover user upsert/select.

## References

- Roadmap S-03: `context/foundation/roadmap.md`
- PRD FR-003: `context/foundation/prd.md`
- Schema F-01: `context/changes/energy-domain-schema/plan.md`
- F-03 evaluation: `context/changes/background-limit-evaluation/plan.md`
- Meter API pattern: `src/pages/api/meters/index.ts`
- Window math: `src/lib/services/consumption-window.ts`
- S-02 handoff: `context/changes/tuya-device-and-consumption/change.md` (S-03 Reuse Notes)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: API and limit service

#### Automated

- [x] 1.1 `npm run lint` passes — 7167bad
- [x] 1.2 `npm run build` passes — 7167bad

#### Manual

- [ ] 1.3 Unauthenticated GET /api/limits returns 401 JSON
- [ ] 1.4 POST creates/updates consumption_limits; GET returns saved limit
- [ ] 1.5 Invalid threshold returns 400 VALIDATION_ERROR

### Phase 2: Window consumption preview helper

#### Automated

- [x] 2.1 `npm run lint` passes — 7a6db1a
- [x] 2.2 `npm run build` passes — 7a6db1a

#### Manual

- [ ] 2.3 Preview sum matches manual sum for seeded readings in current day
- [ ] 2.4 Empty window returns 0 kWh and hasReadings false

### Phase 3: Limit UI component and hook

#### Automated

- [x] 3.1 `npm run lint` passes — d633a3d
- [x] 3.2 `npm run build` passes — d633a3d

#### Manual

- [ ] 3.3 Save shows success banner without full page reload
- [ ] 3.4 Progress bar shows when preview props provided

### Phase 4: Dashboard integration

#### Automated

- [x] 4.1 `npm run lint` passes — 039262d
- [x] 4.2 `npm run build` passes — 039262d

#### Manual

- [ ] 4.3 Limit section visible without registered meter
- [ ] 4.4 End-to-end: meter + limit + sync + preview + F-03 breach path
