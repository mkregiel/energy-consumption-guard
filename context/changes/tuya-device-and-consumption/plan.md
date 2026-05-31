# Tuya Device and Consumption Visibility Implementation Plan

## Overview

Implement roadmap slice S-02: authenticated users connect Tuya / Smart Life, register their energy meter, sync consumption on demand, and view the latest reading plus a short history table in the app. This closes FR-002 and delivers the product north star data path for downstream S-03 (limits) and S-05 (email alarms).

Backend foundation F-02 is complete; this slice adds missing APIs, React hooks, and dashboard UX deferred from F-02 handoff.

## Current State Analysis

- **F-01 implemented:** `meters`, `consumption_readings`, RLS, one meter per user (`meters_user_id_unique`) — `supabase/migrations/20260527120000_energy_domain_schema.sql`.
- **F-02 implemented:** `POST /api/tuya/oauth/callback`, `POST /api/tuya/sync`, `tuya_oauth_tokens`, service layer in `src/lib/services/tuya-client.ts` — handoff in `context/changes/tuya-read-integration/change.md`.
- **Dashboard:** placeholder only — `src/pages/dashboard.astro` (welcome + sign out).
- **Auth UI patterns:** cosmic glass layout, `FormField`, `ServerError`, `Button`, `cn()` — `src/components/auth/*`.
- **No** `src/components/hooks/`, no device list in Tuya transport, no meter REST routes, no OAuth authorize redirect.
- **Middleware:** protects `/dashboard` only — `src/middleware.ts:4`; Tuya routes self-check `locals.user`.
- **F-05** (`protected-api-routes`) not implemented; S-02 includes meter API with the same local session guard pattern as F-02.

### Key Discoveries:

- Sync requires existing `meters` row with `tuya_device_id` — `src/lib/services/tuya-client.ts` (`TUYA_METER_NOT_FOUND`).
- `TuyaConnectionStatus` exists in `src/types.ts` but is unused — suitable for `GET /api/tuya/status`.
- Cookie `tuya_oauth_state` validated in callback when present — `src/pages/api/tuya/oauth/callback.ts:46-49`.
- **Tuya Developer Console requires `https://` callback URLs** — default `npm run dev` serves `http://localhost:4321`; Supabase local auth already lists `https://127.0.0.1:3000` in `additional_redirect_urls` but `site_url` is still `http://127.0.0.1:3000` (`supabase/config.toml:154-156`).
- Roadmap flags time as top blocker — avoid charts; table of N readings is the agreed MVP display (`context/foundation/roadmap.md:158-160`).

## Desired End State

After this plan:

1. User clicks **Connect Tuya**, completes OAuth H5, tokens persist (reuses F-02 callback).
2. User selects a device from Tuya list **or** enters Device ID manually; app upserts their single `meters` row.
3. User clicks **Sync now**; latest reading appears in hero; table shows last N readings from `consumption_readings`.
4. Error states (not linked, no meter, provider failure) show Polish inline banners with a clear next action.
5. Manual E2E proof documented; lint and build pass.

### Verification (user-visible):

- Logged-in user with Smart Life meter sees kWh value and timestamp after sync.
- Repeat sync does not duplicate the same `recorded_at` row.
- User without link sees “Połącz Tuya” CTA, not a broken dashboard.

## What We're NOT Doing

- Historical charts or rolling-window aggregations (roadmap open question deferred)
- Scheduled/cron sync (F-03)
- Consumption limits UI/API (S-03)
- Alarm email configuration (S-04) or breach emails (S-05)
- Global `/api/*` middleware guard (F-05) — only note compatibility in comments
- Multi-meter per user
- Changing Smart Life device configuration (read-only guardrail from PRD)
- ngrok/Cloudflare Tunnel as the **primary** local OAuth path (optional doc mention only; mkcert is the default)

## Implementation Approach

Incremental vertical slices aligned with user journey:

1. **Local HTTPS dev** — trusted cert + `npm run dev:https` on fixed port so Tuya callback URLs validate.
2. **API foundation** — expose connection status, OAuth start, device list, meter CRUD; extend Tuya HTTP transport.
3. **OAuth UI** — connect button, callback page, hook calling existing callback endpoint.
4. **Meter registration** — hybrid device picker + manual fallback form.
5. **Consumption dashboard** — SSR data load, sync island, error mapping.
6. **E2E verification** — real-account checklist and handoff notes for S-03.

Reuse F-02 JSON envelope (`tuyaJsonSuccess` / `tuyaJsonError`), zod on all new routes, `export const prerender = false`. Polish copy in UI; code identifiers in English.

## Critical Implementation Details

### Local HTTPS before Tuya OAuth

Tuya Cloud Project settings reject callback URLs that do not start with `https://`. Local `http://` dev cannot register the real redirect. Phase 1 establishes **`https://127.0.0.1:3000`** (pinned port, matches Supabase `additional_redirect_urls`) with a **mkcert**-trusted certificate so the browser accepts the origin without manual cert exceptions. Production/staging URLs remain separate in Tuya console.

### OAuth redirect URI

Register in Tuya Developer Console: **`https://127.0.0.1:3000/dashboard/tuya/callback`** (local) plus production URL when deployed. `TUYA_OAUTH_REDIRECT_URI` in `.env` must match exactly. `GET /api/tuya/oauth/start` must set `tuya_oauth_state` HttpOnly cookie before redirect. Mismatch causes `TUYA_STATE_MISMATCH` or missing code on return. Use `npm run dev:https` for all Tuya OAuth manual tests — not default `npm run dev`.

### Device list vs sync token path

`sync` may use cloud project token when `TUYA_CLOUD_*` is set (`tuya-client.ts`). Device listing for app OAuth likely needs user access token + `tuya_uid` from `tuya_oauth_tokens`. Implement `listUserDevices` with user token first; document if cloud-only accounts need alternate API. Hybrid manual ID fallback must remain functional when list returns empty.

### Meter upsert semantics

One row per `user_id`. Registering a new device **updates** existing meter (same `id`) rather than insert-second-row (DB unique constraint). DELETE meter is out of scope unless needed for “change device” — prefer UPDATE.

## Phase 1: Local HTTPS Development Environment

### Overview

Enable local Astro dev server over HTTPS with a locally trusted certificate so Tuya Developer Console accepts the OAuth callback URL and the browser sends cookies on the same secure origin. Unblocks all subsequent OAuth phases without relying on production deploy or tunnels.

### Changes Required:

#### 1. Certificate generation script (Windows-first)

**File**: `scripts/generate-dev-certs.ps1` (new)

**Intent**: One-command setup after [mkcert](https://github.com/FiloSottile/mkcert) is installed (`winget install FiloSottile.mkcert` or `choco install mkcert`).

**Contract**: Script runs `mkcert -install` (idempotent), creates `certs/` if missing, generates `certs/127.0.0.1+2.pem` and `certs/127.0.0.1+2-key.pem` for hosts `127.0.0.1` and `localhost`. Prints next steps (trust store, `npm run dev:https`).

#### 2. Certs directory and gitignore

**Files**: `certs/.gitkeep` (new), `.gitignore`

**Intent**: Keep folder in repo without committing private keys.

**Contract**: Ignore `certs/*.pem` and `certs/*.key`; keep `certs/README.md` with mkcert prerequisites and regeneration steps.

#### 3. Astro/Vite HTTPS dev server

**File**: `astro.config.mjs`

**Intent**: When `ASTRO_DEV_HTTPS=1`, enable Vite `server.https` with `fs.readFileSync` on generated cert paths, `server.host: "127.0.0.1"`, `server.port: 3000` (align with Supabase auth redirects).

**Contract**: Default `npm run dev` unchanged (HTTP, Astro default port 4321). HTTPS config activates only via env flag — no cert read at build time; fail fast with clear error if PEM files missing when flag set.

#### 4. npm scripts

**File**: `package.json`

**Intent**: Explicit HTTPS dev entry point.

**Contract**: Add `"dev:https": "cross-env ASTRO_DEV_HTTPS=1 astro dev"` (add `cross-env` devDependency for Windows/macOS parity) OR document PowerShell `$env:ASTRO_DEV_HTTPS='1'; npm run dev` if avoiding new dep — **prefer `cross-env`** for one-liner in README. Optional `"certs:generate": "powershell -ExecutionPolicy Bypass -File scripts/generate-dev-certs.ps1"`.

#### 5. Environment template

**File**: `.env.example`

**Intent**: Document local HTTPS base URL for Tuya OAuth (used in Phase 2 `oauth/start`).

**Contract**: Add commented `TUYA_OAUTH_REDIRECT_URI=https://127.0.0.1:3000/dashboard/tuya/callback` and note it must match Tuya console + `dev:https` port.

#### 6. Supabase local auth alignment

**File**: `supabase/config.toml`

**Intent**: Allow auth redirects and email links when developing on HTTPS origin.

**Contract**: Set `site_url = "https://127.0.0.1:3000"` (or keep `http` for non-Tuya work and rely on `additional_redirect_urls` only — **prefer updating `site_url` to https** with README note that sign-in during Tuya dev uses `dev:https`). Ensure `additional_redirect_urls` includes `https://127.0.0.1:3000/**` if wildcard supported, else exact paths used by app.

#### 7. README — Local HTTPS for Tuya

**File**: `README.md`

**Intent**: Short section: install mkcert → `npm run certs:generate` → `npm run dev:https` → register callback in Tuya console → open `https://127.0.0.1:3000`.

**Contract**: Link to mkcert; warn that `http://localhost:4321` is insufficient for Tuya OAuth registration.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm run build` passes (HTTPS branch must not break production build — cert paths gated on env)
- With certs present and `ASTRO_DEV_HTTPS=1`, dev server starts without throwing (smoke: script or documented manual command)

#### Manual Verification:

- Browser opens `https://127.0.0.1:3000` with **no** certificate warning (mkcert CA trusted)
- Sign-in / sign-up redirect back to app works on HTTPS origin (Supabase local)
- Tuya Developer Console accepts saved callback URL `https://127.0.0.1:3000/dashboard/tuya/callback`
- `http://127.0.0.1:3000` does not accidentally serve the same app instance during Tuya tests (HTTPS-only workflow documented)

**Implementation Note**: Pause for human confirmation that HTTPS dev and Tuya console callback registration work before Phase 2 (API routes that build authorize URLs).

---

## Phase 2: API and Routing Foundation

### Overview

Add server endpoints and service methods required by UI: OAuth start, connection status, Tuya device list, meter registration. Extend protected route list for new dashboard paths.

### Changes Required:

#### 1. Tuya device list in transport

**File**: `src/lib/services/tuya-http.ts`

**Intent**: Add `listUserDevices(uid, accessToken)` calling Tuya Open API (e.g. `GET /v1.0/users/{uid}/devices` or documented equivalent for app OAuth), returning normalized `{ id, name, productId?, online? }[]`.

**Contract**: Method on `HttpTuyaTransport` and `TuyaTransportAdapter`; map provider errors to `TuyaServiceError` with `TUYA_PROVIDER_ERROR`. Empty array is success, not error.

#### 2. Tuya service orchestration

**File**: `src/lib/services/tuya-client.ts`

**Intent**: Export `listLinkedUserDevices(supabase, client, userId)` that loads OAuth token, refreshes if needed (reuse `resolveAccessToken`), calls transport list.

**Contract**: Throws `TUYA_NOT_LINKED` when no token; never returns refresh tokens to callers.

#### 3. Meter service

**File**: `src/lib/services/meter-service.ts` (new)

**Intent**: Encapsulate Supabase `meters` operations for the authenticated user: get current meter, upsert by `user_id`, validate `tuya_device_id` non-empty.

**Contract**: `getUserMeter(supabase, userId)`, `upsertUserMeter(supabase, userId, { label, tuya_device_id, tuya_product_id? })` — upsert on `user_id` conflict updates label and device fields.

#### 4. OAuth start route

**File**: `src/pages/api/tuya/oauth/start.ts` (new)

**Intent**: Start H5 authorization for logged-in user.

**Contract**: `GET`, `prerender = false`, requires `locals.user`. Generates cryptographically random `state`, sets `tuya_oauth_state` cookie (HttpOnly, `Secure` when HTTPS, Path `/`, reasonable Max-Age). Redirects 302 to Tuya authorize URL built from `getTuyaConfig()` using `TUYA_OAUTH_REDIRECT_URI` default `https://127.0.0.1:3000/dashboard/tuya/callback` for local dev. Add `TUYA_OAUTH_REDIRECT_URI` to `astro.config.mjs` env schema.

#### 5. Tuya status route

**File**: `src/pages/api/tuya/status.ts` (new)

**Intent**: Expose safe connection metadata for UI badges.

**Contract**: `GET`, returns `{ linked, accessTokenExpiresAt, tuyaUid }` matching `TuyaConnectionStatus`; 200 with `linked: false` when no token (not 404).

#### 6. Tuya devices route

**File**: `src/pages/api/tuya/devices.ts` (new)

**Intent**: Return device list for picker after OAuth.

**Contract**: `GET`, session required, success `{ devices: Array<{ deviceId, name, productId?, online? }> }`. On `TUYA_NOT_LINKED`, 409 or 400 with stable `error.code` (reuse F-02 codes).

#### 7. Meters API

**Files**: `src/pages/api/meters/index.ts` (new) — `GET` current meter or null; `POST` upsert body `{ label, tuya_device_id, tuya_product_id? }` with zod.

**Intent**: FR-002 persistence without waiting for F-05.

**Contract**: JSON envelope consistent with Tuya routes (reuse `tuyaJsonSuccess`/`tuyaJsonError` or introduce shared `apiJsonSuccess` in `src/lib/services/api-response.ts` if duplication hurts — prefer one envelope). `prerender = false`, `locals.user` guard. POST returns `{ meter: Meter }`.

#### 8. Types

**File**: `src/types.ts`

**Intent**: Add DTOs for new endpoints: `TuyaDeviceSummary`, `TuyaDevicesResult`, `MeterUpsertPayload`, extend exports used by hooks.

**Contract**: Field names align with JSON contracts above; no secrets in response types.

#### 9. Environment

**Files**: `astro.config.mjs`, `.env.example`

**Intent**: Document `TUYA_OAUTH_REDIRECT_URI` (or `PUBLIC_APP_URL` base) if authorize URL requires absolute redirect.

**Contract**: Server-only secret or public base URL per Astro env rules.

#### 10. Protected routes

**File**: `src/middleware.ts`

**Intent**: Guard new dashboard paths.

**Contract**: Extend `PROTECTED_ROUTES` to include `/dashboard` prefix already covers children if using `startsWith` — verify `/dashboard/tuya/callback` is protected (currently `startsWith("/dashboard")` — OK).

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm run build` passes
- New route files export `prerender = false` and uppercase method handlers

#### Manual Verification:

- Unauthenticated `GET /api/tuya/oauth/start` redirects to sign-in or returns 401
- Authenticated start sets cookie and redirects to Tuya (inspect Set-Cookie)
- `GET /api/tuya/status` reflects linked/unlinked after callback
- `POST /api/meters` creates/updates single meter row visible in Supabase Studio

**Implementation Note**: Pause for human confirmation of manual checks before Phase 3.

---

## Phase 3: OAuth Linking UI

### Overview

Wire user-facing connect flow: button → oauth/start → Tuya → callback page → POST callback.

### Changes Required:

#### 1. OAuth callback page

**File**: `src/pages/dashboard/tuya/callback.astro` (new)

**Intent**: Landing page after Tuya redirect reads `code` and `state` from query string.

**Contract**: Protected route under `Layout`; passes query params to React island; shows loading then success/failure states.

#### 2. OAuth callback hook

**File**: `src/components/hooks/useTuyaOAuthCallback.ts` (new)

**Intent**: On mount, `POST /api/tuya/oauth/callback` with `{ code, state }`, track `idle | loading | success | error`.

**Contract**: Parses `TuyaApiSuccess` / `TuyaApiErrorBody`; no `"use client"` directive per AGENTS.md.

#### 3. Connect Tuya component

**File**: `src/components/tuya/TuyaConnectCard.tsx` (new)

**Intent**: Shows link status (from SSR props or client refetch of `/api/tuya/status`), button linking to `GET /api/tuya/oauth/start` (anchor or `window.location`).

**Contract**: Uses `Button`, `cn()`, cosmic card classes matching auth forms. Copy in Polish.

#### 4. Dashboard entry point

**File**: `src/pages/dashboard.astro`

**Intent**: Replace placeholder with shell sections: connection card (Phase 2), placeholders for meter/consumption (filled Phase 3–4) OR split subpages — prefer single `/dashboard` with sections for MVP.

**Contract**: SSR loads `locals.user`; passes `linked` boolean from server-side status check (Supabase token row or internal service) to avoid flash.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- Connect button completes OAuth on real Tuya/Smart Life sandbox account
- Callback page shows success and `tuya_oauth_tokens` row exists
- Invalid/expired state shows error banner with retry CTA
- Cookie `tuya_oauth_state` cleared after success

**Implementation Note**: Pause for human OAuth E2E confirmation before Phase 4.

---

## Phase 4: Meter Registration UI

### Overview

Device picker (Tuya list) with manual Device ID fallback; persists meter via `POST /api/meters`.

### Changes Required:

#### 1. Device list hook

**File**: `src/components/hooks/useTuyaDevices.ts` (new)

**Intent**: Fetch `GET /api/tuya/devices` when linked; expose loading/error/empty states.

**Contract**: On `TUYA_NOT_LINKED`, surface error for parent to show Connect CTA.

#### 2. Meter upsert hook

**File**: `src/components/hooks/useMeterUpsert.ts` (new)

**Intent**: `POST /api/meters` with selected device or manual fields.

**Contract**: Validates non-empty label and `tuya_device_id` client-side before submit (server zod is authoritative).

#### 3. Device picker component

**File**: `src/components/tuya/MeterRegistrationForm.tsx` (new)

**Intent**: Primary UX: radio/list of devices from hook; secondary collapsed section “Wpisz Device ID ręcznie” with `FormField`s.

**Contract**: Reuse `FormField`, `SubmitButton`, `ServerError`. Show empty-list message with manual fallback emphasis. Polish labels.

#### 4. Dashboard integration

**File**: `src/pages/dashboard.astro`

**Intent**: SSR load existing `meters` row; if missing, render `MeterRegistrationForm` (`client:load`); if present, show summary (label, device id truncated) and “Zmień urządzenie” (update flow).

**Contract**: Changing device updates same meter row (POST upsert).

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- Selecting device from list creates `meters` row with correct `tuya_device_id`
- Manual fallback works when list empty or API fails
- Second registration updates existing row (still one per user)
- `POST /api/tuya/sync` succeeds after meter registered

**Implementation Note**: Pause for human meter + sync confirmation before Phase 5.

---

## Phase 5: Consumption Dashboard

### Overview

Display latest reading and history table; Sync button triggers F-02 sync and refreshes SSR view.

### Changes Required:

#### 1. SSR data loading

**File**: `src/pages/dashboard.astro` (or `src/lib/services/consumption-query.ts` new helper)

**Intent**: Query `meters` for user, latest `consumption_readings` by `recorded_at DESC`, and list of last N (e.g. 20) readings.

**Contract**: Use `createClient(Astro.request.headers, Astro.cookies)`; rely on RLS. Handle no meter / no readings gracefully (empty states, not 500).

#### 2. Sync hook

**File**: `src/components/hooks/useTuyaSync.ts` (new)

**Intent**: `POST /api/tuya/sync` with optional `forceRefresh`; on success call `window.location.reload()` (SSR-only refresh decision).

**Contract**: Map `TUYA_*` codes to Polish messages; expose `retry` for button.

#### 3. Error mapping helper

**File**: `src/lib/tuya-error-messages.ts` (new)

**Intent**: Central map `error.code` → `{ message, actionLabel?, actionHref? }` for inline banners.

**Contract**: Cover at least: `TUYA_NOT_LINKED`, `TUYA_METER_NOT_FOUND`, `TUYA_READING_UNAVAILABLE`, `TUYA_AUTH_FAILED`, `TUYA_TOKEN_EXPIRED`, `TUYA_PROVIDER_ERROR`, `TUYA_STATE_MISMATCH`, `UNAUTHORIZED`.

#### 4. Consumption display components

**Files**: `src/components/consumption/ConsumptionHero.tsx`, `src/components/consumption/ConsumptionReadingsTable.tsx` (new)

**Intent**: Hero shows `kwh_cumulative`, `recorded_at` (formatted Europe/Warsaw), `source`; table shows N rows with columns time / kWh / delta if present.

**Contract**: `cn()` for styling; numeric formatting locale-aware (pl-PL). Empty state: “Brak odczytów — zsynchronizuj licznik”.

#### 5. Sync control component

**File**: `src/components/consumption/SyncConsumptionButton.tsx` (new)

**Intent**: Uses `useTuyaSync`; disabled when no meter; shows inline `ServerError` on failure.

**Contract**: Loading state on button consistent with `SubmitButton` spinner pattern.

#### 6. Dashboard layout

**File**: `src/pages/dashboard.astro`

**Intent**: Compose sections: Connect → Register (if needed) → Hero + Table + Sync. Optional `Topbar` for navigation consistency.

**Contract**: Single-page MVP; min-h-screen cosmic layout preserved.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- After sync, hero shows new reading matching Supabase row
- Table lists previous syncs (up to N)
- Repeat sync does not duplicate same timestamp row
- Errors show inline banner with appropriate CTA (link / pick device / retry sync)
- Page usable on mobile-width viewport (readable table or stacked rows)

**Implementation Note**: Pause for human consumption UX confirmation before Phase 6.

---

## Phase 6: E2E Verification and Handoff

### Overview

Document proof, update change metadata, prepare downstream slices.

### Changes Required:

#### 1. Change handoff section

**File**: `context/changes/tuya-device-and-consumption/change.md`

**Intent**: After E2E, append acceptance proof and API/UI inventory for S-03 (similar to F-02 handoff format).

**Contract**: List routes, components, hooks, manual test steps, known limitations.

#### 2. README touch (optional minimal)

**File**: `README.md`

**Intent**: Add short “Tuya setup” bullet: env vars + redirect URI + dashboard path — only if README already documents local dev flows.

**Contract**: No secrets; link to `.env.example`.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- E2E checklist completed: sign-in → connect Tuya → register meter (list path) → sync → view table
- Fallback path tested: manual Device ID registration → sync
- S-03 team can identify which API/UI to reuse for limit configuration
- `change.md` status updated to `implemented` when human accepts

---

## Testing Strategy

### Unit Tests:

- Not in repo scope (AGENTS.md). Rely on lint/build + manual E2E.

### Integration Tests:

- Manual API calls with session cookie for meters and tuya routes
- Two-user RLS spot-check: User B cannot read User A meters/readings (reuse F-01 checklist)

### Manual Testing Steps:

1. Start app with `npm run dev:https`; open `https://127.0.0.1:3000`.
2. Sign in with test account.
3. `GET /api/tuya/oauth/start` — verify redirect and cookie.
4. Complete OAuth — callback success, token row in DB.
5. Open dashboard — device list or manual ID — meter row created.
6. Sync — reading in DB and on dashboard hero + table.
7. Sync again same window — no duplicate `meter_id + recorded_at`.
8. Sign out / User B isolation spot-check.
9. Error paths: sync without meter, connect with wrong state, device list when not linked.

## Performance Considerations

- SSR queries: index `consumption_readings_meter_id_recorded_at_idx` already exists — limit N=20.
- Device list called once per registration session; avoid polling.
- Full page reload after sync is acceptable for MVP (SSR-only decision).

## Migration Notes

- No new migrations expected unless meter constraints change (unlikely).
- If `TUYA_OAUTH_REDIRECT_URI` added, update Cloudflare/production env and Tuya console together.

## References

- F-02 handoff: `context/changes/tuya-read-integration/change.md`
- Roadmap S-02: `context/foundation/roadmap.md:150-161`
- PRD FR-002: `context/foundation/prd.md`
- Schema: `supabase/migrations/20260527120000_energy_domain_schema.sql`
- Tuya callback: `src/pages/api/tuya/oauth/callback.ts`
- Dashboard baseline: `src/pages/dashboard.astro`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: Local HTTPS Development Environment

#### Automated

- [x] 1.1 `npm run lint` passes — 8817dc6
- [x] 1.2 `npm run build` passes — 8817dc6

#### Manual

- [x] 1.3 `npm run certs:generate` produces PEM files in `certs/` — 8817dc6
- [x] 1.4 `npm run dev:https` serves `https://127.0.0.1:3000` without cert warning — 8817dc6
- [x] 1.5 Supabase auth sign-in works on HTTPS origin — 8817dc6
- [x] 1.6 Tuya console accepts callback URL `https://127.0.0.1:3000/dashboard/tuya/callback` — 8817dc6

### Phase 2: API and Routing Foundation

#### Automated

- [x] 2.1 `npm run lint` passes — b616dbe
- [x] 2.2 `npm run build` passes — b616dbe
- [x] 2.3 New Tuya/meter API routes export `prerender = false` and zod validation — b616dbe

#### Manual

- [x] 2.4 OAuth start sets `tuya_oauth_state` and redirects to Tuya (via `dev:https`) — b616dbe
- [x] 2.5 `GET /api/tuya/status` reflects linked state after OAuth — b616dbe
- [x] 2.6 `POST /api/meters` upserts single meter per user — b616dbe

### Phase 3: OAuth Linking UI

#### Automated

- [x] 3.1 `npm run lint` passes — a817ebc
- [x] 3.2 `npm run build` passes — a817ebc

#### Manual

- [x] 3.3 Full OAuth connect flow on real Tuya/Smart Life account — a817ebc
- [x] 3.4 Callback page handles success and state mismatch errors — a817ebc

### Phase 4: Meter Registration UI

#### Automated

- [x] 4.1 `npm run lint` passes — 872c849
- [x] 4.2 `npm run build` passes — 872c849

#### Manual

- [x] 4.3 Device list selection persists correct `tuya_device_id` — 872c849
- [x] 4.4 Manual Device ID fallback works when list empty — 872c849
- [x] 4.5 Sync succeeds after meter registration — 872c849

### Phase 5: Consumption Dashboard

#### Automated

- [x] 5.1 `npm run lint` passes — b5eeccb
- [x] 5.2 `npm run build` passes — b5eeccb

#### Manual

- [x] 5.3 Hero and table show readings after sync — b5eeccb
- [x] 5.4 Repeat sync does not duplicate same `recorded_at` — b5eeccb
- [x] 5.5 Inline error banners show correct CTAs for Tuya error codes — b5eeccb

### Phase 6: E2E Verification and Handoff

#### Automated

- [x] 6.1 `npm run lint` passes — 0c97a76
- [x] 6.2 `npm run build` passes — 0c97a76

#### Manual

- [x] 6.3 Full E2E checklist (link → meter → sync → view) documented in `change.md` — 0c97a76
- [x] 6.4 Human accepts S-02 and status set to `implemented` — 0c97a76
