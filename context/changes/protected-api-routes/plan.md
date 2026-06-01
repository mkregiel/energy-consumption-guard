# Protected API Routes Implementation Plan

## Overview

Implement foundation slice F-05: extend session protection to configuration API routes so they require the same authenticated session as `/dashboard`. Adds middleware-level deny-by-default guard for `/api/*` (with `/api/auth/*` allowlist), shared `requireUser()` helper, and generalized JSON response utilities. Refactors existing meter and Tuya routes to use the shared abstractions and documents the convention for upcoming S-03/S-04 routes.

## Current State Analysis

- **Middleware partial:** `src/middleware.ts` resolves `locals.user` for all requests via `supabase.auth.getUser()` but redirects unauthenticated users only for paths starting with `/dashboard` (`PROTECTED_ROUTES = ["/dashboard"]`).
- **Route-level guards present:** F-02/S-02 added inline `if (!locals.user)` checks to `/api/meters` and all `/api/tuya/*` handlers — six route files, duplicated boilerplate.
- **No shared auth helper:** No `requireUser()` or equivalent in `src/lib/`.
- **JSON envelope in Tuya module:** `tuyaJsonError` / `tuyaJsonSuccess` live in `src/lib/services/tuya-api-response.ts` but are used by non-Tuya routes (`src/pages/api/meters/index.ts`).
- **Auth routes public:** `src/pages/api/auth/signin.ts`, `signup.ts`, `signout.ts` intentionally have no session guard; only `signin.ts` exports `prerender = false`.
- **Future routes missing:** No `/api/limits/*` or `/api/notifications/*` yet (S-03, S-04).

### Key Discoveries:

- Roadmap F-05 outcome: *"device, limit, and notification API routes require the same session as the dashboard"* (`context/foundation/roadmap.md:123-134`).
- F-02/S-02 explicitly deferred global `/api/*` guard and relied on local checks (`context/changes/tuya-read-integration/change.md`, `context/changes/tuya-device-and-consumption/change.md`).
- `oauth/start.ts` redirects unauthenticated users to sign-in (`src/pages/api/tuya/oauth/start.ts:23-27`); with middleware JSON 401, that branch becomes defense-in-depth only (middleware blocks first).
- AGENTS.md requires `prerender = false` on new API routes but `signup.ts` and `signout.ts` omit it.

## Desired End State

After this plan:

1. Unauthenticated requests to any `/api/*` path except `/api/auth/*` receive HTTP 401 with JSON `{ ok: false, error: { code: "UNAUTHORIZED", message: "..." } }`.
2. `src/lib/auth-guard.ts` exports `requireUser(locals)` returning `User` or `Response`.
3. `src/lib/services/api-response.ts` exports `apiJsonError` / `apiJsonSuccess` as the canonical JSON envelope; `tuya-api-response.ts` re-exports them for backward compatibility.
4. All meter and Tuya API handlers use `requireUser()` instead of inline `if (!locals.user)`.
5. AGENTS.md and README document protected API route conventions.
6. Auth flow unchanged: sign-in, sign-up, sign-out, dashboard redirect.
7. `npm run lint` and `npm run build` pass.

## What We're NOT Doing

- New API routes for limits or notifications (S-03, S-04)
- Database migrations or RLS changes
- UI changes
- OAuth CSRF hardening (`tuya_oauth_state` optional validation — tracked in impl-review)
- Service-role / cron endpoints for F-03 background jobs
- Test runner infrastructure
- `withAuth` higher-order handler wrapper (optional future; helper is sufficient for MVP)
- Removing route-level checks in favor of middleware-only (defense in depth retained)

## Implementation Approach

Three sequential phases: (1) extract shared utilities without changing behavior, (2) add middleware guard, (3) refactor routes and update docs. Middleware and helper share the same UNAUTHORIZED message and JSON shape to avoid inconsistent 401 responses.

Deny-by-default rule: any path starting with `/api/` requires `locals.user` unless it starts with `/api/auth/`. Auth routes remain public because they create or destroy sessions.

## Phase 1: Shared API Auth & Response Utilities

### Overview

Introduce canonical JSON response helpers and session guard without changing runtime behavior yet.

### Changes Required:

#### 1. Generalized API response module

**File**: `src/lib/services/api-response.ts` (new)

**Intent**: Provide domain-neutral JSON success/error envelope used by all API routes, not only Tuya integration.

**Contract**: Export `apiJsonError(status, code, message, details?)` and `apiJsonSuccess(status, data)` returning `Response.json` with shapes `{ ok: false, error: { code, message, details? } }` and `{ ok: true, data }` — identical to current `tuyaJsonError` / `tuyaJsonSuccess` contracts.

#### 2. Tuya response module re-export

**File**: `src/lib/services/tuya-api-response.ts`

**Intent**: Avoid breaking imports in Tuya service layer while moving generic helpers to `api-response.ts`.

**Contract**: Import `apiJsonError` / `apiJsonSuccess` from `api-response.ts`; re-export as `tuyaJsonError` / `tuyaJsonSuccess` (aliases). `tuyaErrorResponse(error)` continues to map `TuyaServiceError` to JSON using the shared helpers — no behavior change.

#### 3. Session guard helper

**File**: `src/lib/auth-guard.ts` (new)

**Intent**: Centralize the repeated `if (!locals.user)` pattern and standardize UNAUTHORIZED responses.

**Contract**: Export `requireUser(locals: App.Locals): User | Response` — returns `locals.user` when present, otherwise `apiJsonError(401, "UNAUTHORIZED", "<shared message>")`. Export shared constant or function for the UNAUTHORIZED message string so middleware can reuse the exact same text. Optionally export `requireUserRedirect(locals, redirect, returnTo)` for browser-initiated flows (used by OAuth start handler as defense in depth).

#### 4. Middleware unauthorized response helper (optional co-location)

**File**: `src/lib/auth-guard.ts` or `src/lib/services/api-response.ts`

**Intent**: Single function middleware calls for 401 JSON (e.g. `unauthorizedResponse()`) to guarantee identical payload with `requireUser()`.

**Contract**: Returns the same `Response` as `requireUser()` on missing session.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm run build` passes
- New files exist: `src/lib/services/api-response.ts`, `src/lib/auth-guard.ts`

#### Manual Verification:

- No runtime behavior change yet (middleware and routes untouched in this phase)

**Implementation Note**: After automated verification passes, pause for confirmation before Phase 2.

---

## Phase 2: Middleware Global API Guard

### Overview

Extend middleware to block unauthenticated access to all `/api/*` routes except the auth allowlist, returning JSON 401.

### Changes Required:

#### 1. Middleware API protection

**File**: `src/middleware.ts`

**Intent**: Enforce F-05 at the edge — deny-by-default for API routes so forgotten local guards do not expose endpoints.

**Contract**:

- Add `PUBLIC_API_PREFIXES = ["/api/auth/"]` (or equivalent constant).
- After session resolution, if `pathname.startsWith("/api/")` and no public prefix matches, and `!context.locals.user`, return unauthorized JSON response (shared helper from Phase 1) — do **not** redirect.
- Existing `/dashboard` redirect logic unchanged.
- Session resolution (`getUser()` → `locals.user`) unchanged and still runs before the API guard.

#### 2. Auth route prerender consistency

**File**: `src/pages/api/auth/signup.ts`, `src/pages/api/auth/signout.ts`

**Intent**: Align with AGENTS.md hard rule for SSR API routes.

**Contract**: Add `export const prerender = false` to both files (no logic change).

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- Unauthenticated `GET /api/meters` → 401 JSON with `error.code === "UNAUTHORIZED"`
- Unauthenticated `GET /api/tuya/status` → 401 JSON
- Unauthenticated `POST /api/auth/signin` with valid credentials → redirect (session created)
- Unauthenticated `POST /api/auth/signup` → redirect (no 401 from middleware)
- Authenticated user: existing meter/Tuya routes still reachable (may still use old inline checks until Phase 3)

**Implementation Note**: Pause for manual confirmation of middleware behavior before Phase 3 route refactor.

---

## Phase 3: Route Refactor & Documentation

### Overview

Migrate existing protected API handlers to shared helpers and document conventions for future slices.

### Changes Required:

#### 1. Meter API routes

**File**: `src/pages/api/meters/index.ts`

**Intent**: Replace inline session checks and Tuya-named imports with shared abstractions.

**Contract**: Both `GET` and `POST` call `requireUser(locals)` at handler entry; import `apiJsonError` / `apiJsonSuccess` from `api-response.ts` (or `tuyaErrorResponse` where Tuya errors apply). Remove duplicate UNAUTHORIZED branches.

#### 2. Tuya API routes

**Files**:

- `src/pages/api/tuya/status.ts`
- `src/pages/api/tuya/devices.ts`
- `src/pages/api/tuya/sync.ts`
- `src/pages/api/tuya/oauth/callback.ts`
- `src/pages/api/tuya/oauth/start.ts`

**Intent**: Same refactor as meters; preserve OAuth start redirect via `requireUserRedirect` when session missing (defense in depth — middleware normally prevents this path).

**Contract**: JSON routes use `requireUser()` + `apiJson*` imports. `oauth/start.ts` uses redirect helper for unauthenticated case instead of inline check; config error paths unchanged.

#### 3. AGENTS.md API auth rule

**File**: `AGENTS.md`

**Intent**: Give agents a durable rule when adding S-03/S-04 API routes.

**Contract**: Add concise bullet(s) under Hard Rules or Security: new non-auth API routes are protected by middleware; handlers must still call `requireUser()`; use `apiJsonError`/`apiJsonSuccess` + zod validation; export `prerender = false`; only `/api/auth/*` is public.

#### 4. README auth routes section

**File**: `README.md`

**Intent**: Human-readable documentation matching middleware behavior.

**Contract**: Extend "Route protection" / "Auth routes" section to state `/api/*` (except `/api/auth/*`) requires session; reference `src/middleware.ts` and `src/lib/auth-guard.ts`.

### Success Criteria:

#### Automated Verification:

- `npm run lint` passes
- `npm run build` passes
- Grep: no remaining inline `if (!locals.user)` in `src/pages/api/meters/` and `src/pages/api/tuya/` (except inside `auth-guard.ts`)

#### Manual Verification:

- Full auth smoke test: sign-up → sign-in → dashboard → meter GET → Tuya status → sign-out → protected routes return 401
- No regression in Tuya OAuth connect flow from dashboard (authenticated user)
- Response JSON shape unchanged for existing success/error cases (only import path refactor)

**Implementation Note**: Final manual sign-off completes F-05.

---

## Testing Strategy

### Unit Tests:

- Not in scope — no test runner configured per AGENTS.md.

### Integration Tests:

- Not in scope.

### Manual Testing Steps:

1. Start dev server (`npm run dev` or `npm run dev:https` for Tuya flows).
2. Without session cookie: `GET /api/meters`, `GET /api/tuya/status` → 401 JSON.
3. `POST /api/auth/signin` with form credentials → 302 redirect, session cookie set.
4. With session: repeat meter/Tuya calls → 200 (or domain-specific errors, not 401).
5. `POST /api/auth/signout` → session cleared; protected API returns 401 again.
6. From dashboard while logged in: Tuya connect button → OAuth start redirect works.
7. `npm run lint` and `npm run build`.

## Performance Considerations

Negligible — one additional pathname prefix check in middleware per request. No extra Supabase calls (session already resolved).

## Migration Notes

No data migration. Deploy is code-only. Rollback: revert middleware guard and helper imports; route-level checks remain until Phase 3 completes.

## References

- Roadmap F-05: `context/foundation/roadmap.md`
- Prior deferral: `context/changes/tuya-read-integration/change.md`, `context/changes/tuya-device-and-consumption/change.md`
- Middleware baseline: `src/middleware.ts`
- JSON envelope baseline: `src/lib/services/tuya-api-response.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: Shared API auth & response utilities

#### Automated

- [x] 1.1 `npm run lint` passes — e6db744
- [x] 1.2 `npm run build` passes — e6db744
- [x] 1.3 `src/lib/services/api-response.ts` and `src/lib/auth-guard.ts` exist — e6db744

#### Manual

- [x] 1.4 No runtime behavior change confirmed (utilities only) — e6db744

### Phase 2: Middleware global API guard

#### Automated

- [x] 2.1 `npm run lint` passes
- [x] 2.2 `npm run build` passes

#### Manual

- [x] 2.3 Unauthenticated protected API returns 401 JSON
- [x] 2.4 Auth routes remain public (signin/signup/signout)
- [x] 2.5 Authenticated meter/Tuya routes still reachable

### Phase 3: Route refactor & documentation

#### Automated

- [ ] 3.1 `npm run lint` passes
- [ ] 3.2 `npm run build` passes
- [ ] 3.3 No inline `if (!locals.user)` in meter/tuya route handlers

#### Manual

- [ ] 3.4 Full auth + API smoke test passes
- [ ] 3.5 Tuya OAuth connect flow from dashboard works
- [ ] 3.6 AGENTS.md and README updated
