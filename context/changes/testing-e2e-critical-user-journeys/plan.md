# Testing E2E Critical User Journeys — Implementation Plan

## Overview

Phase 5 of `context/foundation/test-plan.md`: build the Playwright E2E
infrastructure and three test files covering R-E1 (Tuya OAuth connect),
R-E2 (auth redirect to/from `/dashboard`), and R-E3 (dashboard form
round-trips). Along the way, fix a real production bug discovered during
framing — `src/middleware.ts` drops the `returnTo` target when redirecting
unauthenticated `/dashboard` visits.

## Current State Analysis

- `playwright.config.ts` has `globalSetup: "./e2e/global-setup.ts"` and a
  `storageState: "e2e/user.json"` shared by all tests, but its `webServer`
  block is commented out — the dev server must be started manually today.
- `e2e/global-setup.ts` logs in as `kregielm@gmail.com` / `asdzxc` and saves
  storage state, waiting for `https://127.0.0.1:3000/` (the landing page,
  not `/dashboard`).
- `e2e/seed.spec.ts` already exercises `/api/tuya/sync` interception and a
  notification-email-persists-after-reload flow — the new specs follow the
  same locator/assertion conventions.
- `src/middleware.ts:25-29` redirects unauthenticated `/dashboard` visits to
  `/auth/signin` with **no `returnTo`** — `src/lib/auth-redirect.ts`'s
  `sanitizeReturnTo`, `src/pages/auth/signin.astro`, and
  `src/components/auth/SignInForm.tsx` (hidden `returnTo` input) and
  `src/pages/api/auth/signin.ts` (redirects to `returnTo ?? "/"` on success)
  already form a complete `returnTo` round trip — only the middleware's
  initial redirect is missing the query param.
- Tuya OAuth chain (`src/pages/api/tuya/oauth/start.ts` →
  `src/pages/dashboard/tuya/callback.astro` →
  `src/components/tuya/TuyaOAuthCallbackPanel.tsx` →
  `src/pages/api/tuya/oauth/callback.ts` → `src/lib/services/tuya-client.ts`)
  is fully server-side from the code-exchange step onward, and
  `TUYA_API_BASE_URL` (`astro.config.mjs:116`, `src/lib/services/tuya-config.ts`)
  is the only hook needed to redirect that traffic to a local stub.
- `src/lib/services/tuya-http.ts:539-549` (`listUserDevices`) and
  `:273-291` (`exchangeAuthorizationCode`) define the exact request/response
  shapes the stub must satisfy: `GET /v1.0/token?grant_type=2&code=...` and
  `GET /v1.0/users/{uid}/devices?from=home&page_no=1&page_size=50`, both
  wrapped in `{ success, result, t }` (`TuyaApiEnvelope`).
- `src/lib/services/tuya-client.ts:67-70` (`createTuyaClient`) calls
  `probeSdkTransportAvailability()` first — confirmed
  (`src/lib/services/tuya-http.ts:603-611`) this only attempts a dynamic
  `import("@tuya/tuya-connector-nodejs")`, catches the failure, and always
  falls back to `HttpTuyaTransport`. No network call — safe against the stub.
- `src/lib/services/tuya-config.ts`'s `getMissingTuyaConfigKeys()` requires
  only `TUYA_CLIENT_ID`, `TUYA_CLIENT_SECRET`, `TUYA_API_BASE_URL`,
  `TUYA_API_REGION`; `getCloudDeviceReadConfig()` returns `null` without
  `TUYA_CLOUD_CLIENT_ID`/`SECRET`, so `listLinkedUserDevices` falls back to
  `client.listUserDevices` against the stub.
- `vitest.setup.ts` has a small hand-rolled `.env.test` parser
  (no `dotenv` dependency); `.env.test` is gitignored
  (`.gitignore:28`) and `.env.test.example` documents the convention.
- `scripts/seed-test-breach.ts` is the established pattern for a
  service-role Supabase Node script (env validation, JWT-shape check,
  `createClient` with `persistSession: false`).
- No `concurrently` dependency exists; `tsx` (`^4.22.4`) is already a
  devDependency and used by `seed:test-breach`.
- `src/components/limits/ConsumptionLimitForm.tsx:40,127-134`: after a
  successful submit, `effectiveThreshold` updates immediately to the saved
  value and the progress bar re-renders with it — but only when
  `preview.hasReadings` is true (otherwise a "Brak odczytów..." message
  shows instead, with no threshold text). The success banner
  ("Limit zapisany pomyślnie.") always shows regardless.
- `src/components/notifications/AlarmEmailForm.tsx` shows
  "Adres e-mail został zapisany." (success message) immediately after POST
  resolves, independent of `e2e/seed.spec.ts`'s existing
  reload-persistence test.

### Key Discoveries

- `src/pages/api/tuya/oauth/start.ts:24` can be called via
  `page.request.get("/api/tuya/oauth/start", { maxRedirects: 0 })` — it
  shares cookies with the page's browser context (sets `tuya_oauth_state`)
  and its `Location` response header contains the real `state` value as a
  query param, so the test never needs to parse cookies directly.
- `src/lib/services/tuya-client.ts:95` (`saveUserOAuthToken`) upserts on
  `user_id` — idempotent, but cleanup is still needed because
  `tuya_oauth_tokens` rows persist across test runs and other suites
  (R-E3) share the same logged-in user.
- `e2e/global-setup.ts:27` waits for `https://127.0.0.1:3000/` (not
  `/dashboard`) — the middleware fix in Phase 2 does not affect this, since
  `/` is not in `PROTECTED_ROUTES`.

## Desired End State

- `npx playwright test` (no manual dev server) starts a local Tuya stub and
  the HTTPS dev server automatically, runs all specs, and tears both down.
- Visiting `/dashboard` while logged out redirects to
  `/auth/signin?returnTo=%2Fdashboard`, and a successful login from there
  lands back on `/dashboard`.
- `e2e/tuya-oauth-connect.spec.ts`, `e2e/auth-redirect.spec.ts`, and
  `e2e/dashboard-forms.spec.ts` exist and pass.
- `context/foundation/test-plan.md` Phase 5 row can move to "implemented"
  once `/10x-test-plan` reconciles status (out of scope for this plan —
  same pattern as the Phase 4 reconciliation commit).

## What We're NOT Doing

- Driving the real Tuya consent UI (`accounts.tuya.com`) — out of scope per
  `frame.md`, blocked by anti-bot CAPTCHA and not our code.
- CI integration of the `webServer` config — local-only for this phase; CI
  wiring is a follow-up.
- Asserting `preview.consumptionKwh` reflects a newly-saved threshold
  (`ConsumptionLimitForm`'s `preview` prop is computed server-side at page
  load and does not refetch after submit) — R-E3's limit-form test asserts
  the success message and the threshold portion of the progress bar only.
  This staleness gap should be added to test-plan.md §7 during the next
  `/10x-test-plan` reconciliation.
- Testing Tuya cloud-credential device listing (`getCloudDeviceReadConfig`
  path) — `.env.test` deliberately omits `TUYA_CLOUD_CLIENT_ID`/`SECRET` so
  the user-OAuth `listUserDevices` path (the one R-E1 exercises) is used.
- Refreshing/expiring Tuya tokens — out of scope for R-E1 (covered by
  `tuya-token-sync.test.ts` at the integration layer).

## Implementation Approach

Five phases, each independently shippable:

1. Build the shared E2E infrastructure (Tuya stub server, `webServer`
   wiring, env file, DB cleanup helper) — nothing depends on this being
   "real," only on the contracts it exposes.
2. Fix the `middleware.ts` `returnTo` gap — small, isolated, unblocks R-E2.
3. R-E1 spec, built on Phase 1's stub.
4. R-E2 spec, built on Phase 2's fix.
5. R-E3 specs, independent of Phases 1-2 (uses existing dashboard, no stub
   needed).

## Phase 1: E2E test infrastructure

### Overview

Stand up a local Tuya HTTP stub, wire it into a Playwright `webServer` that
also launches the HTTPS dev server with `TUYA_API_BASE_URL` overridden, add
`.env.test` placeholders, and add a DB cleanup helper for
`tuya_oauth_tokens`.

### Changes Required:

#### 1. Tuya stub server

**File**: `e2e/tuya-stub-server.ts` (new)

**Intent**: A minimal `node:http` server (no framework) that fakes Tuya's
`/v1.0/token` (authorization-code exchange) and
`/v1.0/users/{uid}/devices` endpoints, wrapped in Tuya's
`{ success, result, t }` envelope. It does not validate HMAC signatures —
the app's `HttpTuyaTransport` always sends them, but the stub ignores auth
headers entirely.

**Contract**: Export an async `startTuyaStub(): Promise<{ url: string; close: () => Promise<void> }>` that listens on an ephemeral port (`listen(0)`)
and returns its base URL (e.g. `http://127.0.0.1:PORT`).

- `GET /v1.0/token` with `grant_type=2&code=<code>`:
  - If `code === "e2e-tuya-error"`, respond `200` with
    `{ success: false, code: 1106, msg: "e2e stub: invalid code" }`
    (matches `parseTuyaResponse`'s `!payload.success` error path).
  - Otherwise respond `200` with
    `{ success: true, result: { uid: "e2e-tuya-uid", access_token: "e2e-access-token", refresh_token: "e2e-refresh-token", expire_time: 7200 }, t: Date.now() }`.
- `GET /v1.0/users/:uid/devices`: respond `200` with
  `{ success: true, result: [{ id: "e2e-device-1", name: "E2E Test Meter", product_id: "e2e-product", online: true }], t: Date.now() }`.
- Any other path: respond `404` with `{ success: false, code: 404, msg: "not found" }`.

#### 2. Shared `.env.test` loader

**File**: `e2e/load-test-env.ts` (new)

**Intent**: Reuse the manual `.env.test` parsing already in
`vitest.setup.ts` so both the webServer wrapper (Phase 1.3) and the R-E1
cleanup helper (Phase 1.4) can read `SUPABASE_URL` /
`SUPABASE_SERVICE_ROLE_KEY` / `TUYA_*` without adding a `dotenv` dependency.

**Contract**: Export `loadTestEnv(): void` with the same body as
`vitest.setup.ts`'s `setup()` (read `.env.test` from `process.cwd()`, skip
blank/`#` lines, only set keys not already in `process.env`). Update
`vitest.setup.ts` to import and call this shared function instead of
duplicating the parser.

#### 3. Playwright webServer wrapper

**File**: `e2e/start-webserver.ts` (new)

**Intent**: The single command Playwright's `webServer` runs. Loads
`.env.test`, starts the Tuya stub, overrides `TUYA_API_BASE_URL` to point
at it, then spawns `npm run dev:https` as a child process with the merged
env, forwarding stdout/stderr and exit code.

**Contract**: Run via `tsx e2e/start-webserver.ts`. On `SIGTERM`/`SIGINT`
(Playwright's teardown signal), kill the child dev-server process and call
`close()` on the stub before exiting — this lets `reuseExistingServer`
based re-runs and `Ctrl+C` clean up both processes.

#### 4. Playwright config wiring

**File**: `playwright.config.ts`

**Intent**: Replace the commented-out `webServer` block (lines 84-88) with
a real one pointing at the wrapper script.

**Contract**:

```ts
webServer: {
  command: "npx tsx e2e/start-webserver.ts",
  url: "https://127.0.0.1:3000",
  reuseExistingServer: !process.env.CI,
  ignoreHTTPSErrors: true,
  timeout: 60_000,
},
```

#### 5. `.env.test` placeholders

**File**: `.env.test` (new, gitignored)

**Intent**: Provide the four required `TUYA_*` config keys so
`getMissingTuyaConfigKeys()` passes, plus Supabase service-role credentials
for the cleanup helper.

**Contract**: `TUYA_CLIENT_ID=e2e-client-id`, `TUYA_CLIENT_SECRET=e2e-client-secret`,
`TUYA_API_REGION=eu` (placeholders — never sent to a real Tuya endpoint
since `TUYA_API_BASE_URL` is overridden to the stub), plus real
`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` values (same project as
`e2e/global-setup.ts`'s `kregielm@gmail.com` test user). Mirror the format
of `.env.test.example`; also add these four `TUYA_*` keys (with empty
values) to `.env.test.example` so the convention is documented.

#### 6. Tuya OAuth token cleanup helper

**File**: `e2e/lib/tuya-cleanup.ts` (new)

**Intent**: Service-role Supabase client (same pattern as
`scripts/seed-test-breach.ts`) that deletes the `tuya_oauth_tokens` row for
the e2e test user after R-E1's spec runs, keeping the suite idempotent
across reruns.

**Contract**: Export `deleteTuyaOAuthTokenForTestUser(): Promise<void>`.
Resolve the test user's id via `supabase.auth.admin.listUsers()` filtering
for email `"kregielm@gmail.com"` (same credential `e2e/global-setup.ts`
uses), then `supabase.from("tuya_oauth_tokens").delete().eq("user_id", id)`.
Calls `loadTestEnv()` (Phase 1.2) at the top so `SUPABASE_URL` /
`SUPABASE_SERVICE_ROLE_KEY` are available when run from the Playwright test
process.

#### 7. `package.json` script

**File**: `package.json`

**Intent**: Add a named script so the e2e suite has a documented entry
point alongside `test`/`test:ci`.

**Contract**: Add `"test:e2e": "playwright test"` to `scripts`.

### Success Criteria:

#### Automated Verification:

- [ ] `npx tsx e2e/tuya-stub-server.ts` (or a small smoke script) starts and
      responds to `GET /v1.0/token?grant_type=2&code=test` and
      `GET /v1.0/users/e2e-tuya-uid/devices` with the documented envelopes
- [ ] `npm run test:e2e -- --list` succeeds (config loads, no syntax errors)
- [ ] `npx tsc --noEmit` passes (new files type-check)
- [ ] `npm run test` still passes (vitest.setup.ts refactor doesn't break
      existing unit/integration tests)

#### Manual Verification:

- [ ] Running `npm run test:e2e` (with no dev server already running)
      starts both the stub and `dev:https`, and tears both down on
      completion/`Ctrl+C`
- [ ] `e2e/seed.spec.ts` (existing) still passes against the auto-started
      server

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that
the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Fix `src/middleware.ts` returnTo gap

### Overview

Preserve the originally-requested URL when redirecting an unauthenticated
`/dashboard` visit to `/auth/signin`, so login lands the user back where
they started. This is a real bug found during framing, independent of the
E2E tests but required for R-E2 to assert meaningful behavior.

### Changes Required:

#### 1. Middleware redirect

**File**: `src/middleware.ts`

**Intent**: When `PROTECTED_ROUTES` matches and `context.locals.user` is
null, redirect to `/auth/signin` with a `returnTo` query param carrying the
original `pathname + search`, so the existing `sanitizeReturnTo` →
`SignInForm` hidden input → `/api/auth/signin` round trip (already
implemented) lands the user back on `/dashboard` after login.

**Contract**: Replace `return context.redirect("/auth/signin")` (line 27)
with a redirect to `/auth/signin?returnTo=<encoded pathname+search>`, using
`encodeURIComponent` on `context.url.pathname + context.url.search`.

### Success Criteria:

#### Automated Verification:

- [ ] `npx tsc --noEmit` passes
- [ ] Existing middleware/auth-guard unit tests pass (`npm run test`)

#### Manual Verification:

- [ ] Visiting `https://127.0.0.1:3000/dashboard` while logged out redirects
      to `/auth/signin?returnTo=%2Fdashboard`

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that
the manual testing was successful before proceeding to the next phase.

---

## Phase 3: R-E1 — Tuya OAuth connect E2E test

### Overview

Exercise the OAuth start → callback → dashboard-rehydration chain (frame.md
stages 2-4) against the Phase 1 stub, plus an error-path case, without ever
navigating to Tuya's hosted consent UI.

### Changes Required:

#### 1. R-E1 spec

**File**: `e2e/tuya-oauth-connect.spec.ts` (new)

**Intent**: Two tests sharing one `describe` block, both using the default
logged-in `storageState`.

**Contract**:

- **Setup helper** (shared by both tests): call
  `page.request.get("/api/tuya/oauth/start", { maxRedirects: 0 })`, read the
  `Location` response header, and extract its `state` query param — this is
  the real `tuya_oauth_state` value the cookie now holds.
- **Happy path** ("Tuya OAuth connect stores token and shows linked device"):
  1. Run the setup helper to get `state`.
  2. `page.goto("/dashboard/tuya/callback?code=e2e-tuya-token&state=" + state)`.
  3. Wait for the panel's POST to `/api/tuya/oauth/callback` to resolve
     (`page.waitForResponse`), assert `linked: true` in the JSON body.
  4. Assert `getByText("Konto Tuya zostało połączone.")` is visible.
  5. Navigate to `/dashboard` (via the panel's button or `page.goto`).
  6. Assert `TuyaConnectCard` shows `getByText("Konto Tuya jest połączone")`
     and the stub's uid (`e2e-tuya-uid`) somewhere in the card.
  7. Open the meter registration form (edit mode) and assert
     `getByText("E2E Test Meter")` (the stub's device name) is visible —
     confirms `useTuyaDevices` hit the stub's `/v1.0/users/{uid}/devices`.
- **Error path** ("Tuya OAuth error response surfaces in callback panel"):
  1. Run the setup helper again for a fresh `state`.
  2. `page.goto("/dashboard/tuya/callback?code=e2e-tuya-error&state=" + state)`.
  3. Wait for the `/api/tuya/oauth/callback` response, assert non-2xx /
     error JSON shape.
  4. Assert `getByText("Nie udało się połączyć konta")` is visible and
     `getByRole("button", { name: "Połącz ponownie" })` is present.
- **`afterAll`**: call `deleteTuyaOAuthTokenForTestUser()` (Phase 1.6) to
  remove the row the happy-path test created, keeping reruns idempotent.

### Success Criteria:

#### Automated Verification:

- [ ] `npm run test:e2e -- e2e/tuya-oauth-connect.spec.ts` passes on
      `chromium`
- [ ] `npx tsc --noEmit` passes

#### Manual Verification:

- [ ] Test passes on `firefox` and `webkit` projects too
- [ ] Re-running the spec twice in a row both pass (cleanup is effective)

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that
the manual testing was successful before proceeding to the next phase.

---

## Phase 4: R-E2 — Auth redirect E2E test

### Overview

Verify that an unauthenticated `/dashboard` visit redirects to sign-in with
a `returnTo`, and that logging in from there lands back on `/dashboard` —
exercising the Phase 2 fix.

### Changes Required:

#### 1. R-E2 spec

**File**: `e2e/auth-redirect.spec.ts` (new)

**Intent**: Run with a fresh, unauthenticated browser context (no
`storageState`) so no session cookie leaks in from `e2e/user.json`.

**Contract**:

- `test.use({ storageState: { cookies: [], origins: [] } })` to override the
  project-level `storageState` for this file.
- `page.goto("/dashboard")`.
- Assert `page.waitForURL(/\/auth\/signin\?returnTo=%2Fdashboard/)`.
- Fill `getByRole("textbox", { name: "Email" })` and
  `getByRole("textbox", { name: "Password" })` — note: `SignInForm.tsx`
  labels these "Email"/"Password" via `FormField` (vs. `global-setup.ts`'s
  lowercase "email"/"password" — verify exact accessible names against the
  rendered `FormField` component before writing locators) with the same
  credentials as `e2e/global-setup.ts`.
- Click `getByRole("button", { name: "Sign in" })`.
- Assert `page.waitForURL("https://127.0.0.1:3000/dashboard")`.

### Success Criteria:

#### Automated Verification:

- [ ] `npm run test:e2e -- e2e/auth-redirect.spec.ts` passes on `chromium`
- [ ] `npx tsc --noEmit` passes

#### Manual Verification:

- [ ] Test passes on `firefox` and `webkit` projects too
- [ ] Confirms no cross-test session leakage (test passes when run alongside
      the full suite, not just in isolation)

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that
the manual testing was successful before proceeding to the next phase.

---

## Phase 5: R-E3 — Dashboard form round-trip E2E tests

### Overview

Two independent tests: the consumption-limit form (threshold + success
message + progress bar threshold reflects the new value) and a new
email-form immediate-post-submit assertion (distinct from
`e2e/seed.spec.ts`'s existing reload-persistence test).

### Changes Required:

#### 1. R-E3 spec

**File**: `e2e/dashboard-forms.spec.ts` (new)

**Intent**: Two tests, both using the default logged-in `storageState`,
each navigating to `/dashboard` independently for test isolation.

**Contract**:

- **Limit form test** ("Consumption limit form shows updated threshold
  after save"):
  1. `page.goto("/dashboard")`.
  2. Fill `getByRole("textbox", { name: "Próg zużycia (kWh)" })` with a new
     numeric value distinct from the current one (e.g. read current value
     first, then set `current + 1`).
  3. Click `getByRole("button", { name: "Zapisz limit" })`.
  4. Wait for the `/api/limits` POST response.
  5. Assert `getByText("Limit zapisany pomyślnie.")` is visible.
  6. If the progress bar is rendered (`preview.hasReadings` true for this
     user), assert its text contains the new threshold value (per
     `ConsumptionLimitForm.tsx:132`, `effectiveThreshold` updates from the
     POST response immediately). If not rendered, skip this assertion —
     do not assert on `consumptionKwh` (out of scope, see "What We're NOT
     Doing").
- **Email form test** ("Alarm email form shows success message immediately
  after save") — independent of `e2e/seed.spec.ts`'s existing test:
  1. `page.goto("/dashboard")`.
  2. Fill `getByRole("textbox", { name: "Adres e-mail" })` with a
     timestamp-suffixed unique value (e.g. `e2e-${Date.now()}@example.com`).
  3. Click `getByRole("button", { name: "Zapisz adres e-mail" })`.
  4. Wait for the `/api/notifications` POST response.
  5. Assert the success message is visible immediately (no
     `page.reload()`) — confirms `AlarmEmailForm`'s post-submit UI update
     without depending on the reload-persistence test.

### Success Criteria:

#### Automated Verification:

- [ ] `npm run test:e2e -- e2e/dashboard-forms.spec.ts` passes on `chromium`
- [ ] `npx tsc --noEmit` passes

#### Manual Verification:

- [ ] Test passes on `firefox` and `webkit` projects too
- [ ] Full suite (`npm run test:e2e`) passes end-to-end with the `webServer`
      auto-starting both the stub and dev server

**Implementation Note**: After completing this phase and all automated
verification passes, pause here for manual confirmation from the human that
the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- No new unit tests — this plan is entirely E2E + one middleware fix.
- Phase 2's middleware fix should be covered by existing
  `src/middleware.ts` / `auth-guard` test files if they assert on redirect
  targets; if no such assertion exists, that's acceptable (E2E covers it).

### Integration Tests:

- None — `tuya-token-sync.test.ts` already covers token refresh at the
  integration layer (out of scope here).

### Manual Testing Steps:

1. Run `npm run test:e2e` from a clean checkout (no dev server, no
   `e2e/user.json`) and confirm `globalSetup` + `webServer` both bootstrap
   correctly.
2. Re-run `npm run test:e2e` immediately after — confirm idempotency
   (cleanup helper, upsert semantics).
3. Manually visit `/dashboard` logged out, confirm `returnTo` round trip
   end to end in a real browser.

## Performance Considerations

None — the stub server is in-process Node, ephemeral-port, and only used
for E2E.

## Migration Notes

None — no schema or data changes. `.env.test` is local-only and gitignored.

## References

- Frame brief: `context/changes/testing-e2e-critical-user-journeys/frame.md`
- `src/pages/api/tuya/oauth/start.ts:24-57`
- `src/pages/dashboard/tuya/callback.astro`
- `src/components/tuya/TuyaOAuthCallbackPanel.tsx`
- `src/pages/api/tuya/oauth/callback.ts`
- `src/lib/services/tuya-client.ts:67-70,84-98`
- `src/lib/services/tuya-http.ts:273-291,539-553,603-611`
- `src/lib/services/tuya-config.ts`
- `src/middleware.ts:25-29`
- `src/lib/auth-redirect.ts`
- `src/components/auth/SignInForm.tsx:45`
- `src/components/limits/ConsumptionLimitForm.tsx:40,127-134`
- `vitest.setup.ts`
- `scripts/seed-test-breach.ts`
- `playwright.config.ts:84-88`
- `e2e/global-setup.ts`
- `e2e/seed.spec.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a
> step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: E2E test infrastructure

#### Automated

- [x] 1.1 Tuya stub responds to `/v1.0/token` and `/v1.0/users/{uid}/devices` with documented envelopes — ecd4ead
- [x] 1.2 `npm run test:e2e -- --list` succeeds — ecd4ead
- [x] 1.3 `npx tsc --noEmit` passes — ecd4ead
- [x] 1.4 `npm run test` still passes after `vitest.setup.ts` refactor — ecd4ead

#### Manual

- [x] 1.5 `npm run test:e2e` auto-starts and tears down stub + dev server — ecd4ead
- [x] 1.6 `e2e/seed.spec.ts` still passes against the auto-started server — ecd4ead

### Phase 2: Fix src/middleware.ts returnTo gap

#### Automated

- [x] 2.1 `npx tsc --noEmit` passes — 1a076d4
- [x] 2.2 Existing middleware/auth-guard unit tests pass — 1a076d4

#### Manual

- [x] 2.3 `/dashboard` while logged out redirects to `/auth/signin?returnTo=%2Fdashboard` — 1a076d4

### Phase 3: R-E1 — Tuya OAuth connect E2E test

#### Automated

- [ ] 3.1 `e2e/tuya-oauth-connect.spec.ts` passes on chromium
- [ ] 3.2 `npx tsc --noEmit` passes

#### Manual

- [ ] 3.3 Spec passes on firefox and webkit
- [ ] 3.4 Re-running the spec twice in a row both pass

### Phase 4: R-E2 — Auth redirect E2E test

#### Automated

- [ ] 4.1 `e2e/auth-redirect.spec.ts` passes on chromium
- [ ] 4.2 `npx tsc --noEmit` passes

#### Manual

- [ ] 4.3 Spec passes on firefox and webkit
- [ ] 4.4 No cross-test session leakage when run with the full suite

### Phase 5: R-E3 — Dashboard form round-trip E2E tests

#### Automated

- [ ] 5.1 `e2e/dashboard-forms.spec.ts` passes on chromium
- [ ] 5.2 `npx tsc --noEmit` passes

#### Manual

- [ ] 5.3 Spec passes on firefox and webkit
- [ ] 5.4 Full `npm run test:e2e` suite passes end-to-end
