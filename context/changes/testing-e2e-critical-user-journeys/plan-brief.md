# Testing E2E Critical User Journeys — Plan Brief

> Full plan: `context/changes/testing-e2e-critical-user-journeys/plan.md`
> Frame brief: `context/changes/testing-e2e-critical-user-journeys/frame.md`

## What & Why

This is Phase 5 of `context/foundation/test-plan.md`: build E2E coverage for
the three highest-risk user journeys — Tuya OAuth connect (R-E1), the auth
redirect to/from `/dashboard` (R-E2), and the limit/email dashboard forms
(R-E3). Per `frame.md`'s reframed problem statement, R-E1's E2E test
exercises our app's OAuth start → callback → dashboard-rehydration chain
against a **local stub Tuya token-exchange endpoint**, never navigating to
the real `accounts.tuya.com` consent UI (which has an anti-bot CAPTCHA and
is correctly out of scope).

## Starting Point

`playwright.config.ts` has a working `globalSetup` (logs in, saves
`storageState`) but its `webServer` block is commented out — today the dev
server must be started manually. `TUYA_API_BASE_URL` is already a
configurable server env var (`astro.config.mjs:116`), but no stub server or
env-override mechanism exists yet. `src/middleware.ts` redirects
unauthenticated `/dashboard` visits to `/auth/signin` but drops the
`returnTo` param — even though the rest of the round trip
(`sanitizeReturnTo`, `SignInForm`'s hidden input, `/api/auth/signin`'s
post-login redirect) is already implemented and just unused.

## Desired End State

`npm run test:e2e` runs the full suite from a clean checkout with zero
manual setup: it boots a local Tuya stub + the HTTPS dev server, runs three
new spec files (Tuya OAuth connect, auth redirect, dashboard forms) plus the
existing `e2e/seed.spec.ts`, and tears everything down. Logging in from a
`/dashboard` redirect lands the user back on `/dashboard`.

## Key Decisions Made

| Decision                   | Choice                                                                     | Why (1 sentence)                                                                                     | Source |
| -------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------ |
| R-E1 scope                 | Exercise stages 2-4 (redirect/callback/rehydration) via stub               | Stage 1 (Tuya consent UI) is genuinely untestable; stage 3 (token exchange) needed a stub regardless | Frame  |
| R-E1 stub coverage         | Stub both `/v1.0/token` and `/v1.0/users/{uid}/devices`                    | "Linked status + device list visible" requires the device-list call too                              | Plan   |
| Dev server orchestration   | New `webServer` running `tsx e2e/start-webserver.ts` (stub + dev:https)    | No `concurrently` dep; `tsx` already used by `seed:test-breach`                                      | Plan   |
| R-E1 callback entry        | `page.request.get("/api/tuya/oauth/start")`, parse `state` from `Location` | Shares cookies with the page context; avoids parsing `Set-Cookie` directly                           | Plan   |
| R-E1 error path            | Add a second test for Tuya error response                                  | `TuyaOAuthCallbackPanel`'s error UI is otherwise untested                                            | Plan   |
| R-E2 fix                   | Fix `src/middleware.ts` to preserve `returnTo`                             | Real bug found during framing; the rest of the round trip already exists unused                      | Plan   |
| R-E2 redirect target       | `pathname + search` of the original request                                | Generalizes beyond `/dashboard` to any protected route with query params                             | Plan   |
| R-E3 consumption staleness | Out of scope, document as test-plan §7 follow-up                           | `preview` prop is server-rendered at page load and doesn't refetch after submit                      | Plan   |
| R-E3 email test            | New, independent test (not extending `e2e/seed.spec.ts`)                   | Tests immediate post-submit UI, distinct from the existing reload-persistence test                   | Plan   |
| File layout                | One spec file per risk                                                     | Matches `context/foundation/test-plan.md`'s "each test maps to one risk" convention                  | Plan   |
| CI scope                   | Local-only for now, CI is a follow-up                                      | Keeps this phase focused; CI wiring for `webServer` is a separate concern                            | Plan   |
| R-E1 cleanup               | `afterAll` DB cleanup via service-role client                              | Idempotent upsert exists, but other suites share the same logged-in test user                        | Plan   |

## Scope

**In scope:**

- Local Tuya stub server (`/v1.0/token`, `/v1.0/users/{uid}/devices`)
- `playwright.config.ts` `webServer` wiring + `.env.test` placeholders
- `tuya_oauth_tokens` cleanup helper
- `src/middleware.ts` `returnTo` fix
- 3 new spec files: `tuya-oauth-connect.spec.ts`, `auth-redirect.spec.ts`, `dashboard-forms.spec.ts`

**Out of scope:**

- Real Tuya consent UI / CAPTCHA
- CI integration of `webServer`
- `preview.consumptionKwh` staleness after limit-threshold change
- Tuya cloud-credential device listing path
- Token refresh/expiry testing

## Architecture / Approach

A new `tsx e2e/start-webserver.ts` script becomes Playwright's `webServer`
command: it loads `.env.test`, starts an in-process Tuya stub on an
ephemeral port, overrides `TUYA_API_BASE_URL` to point at it, and spawns
`npm run dev:https` with the merged env. Specs then drive the existing app
UI/API as usual — R-E1 calls `/api/tuya/oauth/start` directly to get a real
`state`, then navigates to the callback URL with a stub-recognized `code`.

## Phases at a Glance

| Phase                               | What it delivers                                                  | Key risk                                                       |
| ----------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------- |
| 1. E2E test infrastructure          | Tuya stub, `webServer` wiring, `.env.test`, cleanup helper        | New process orchestration (stub + dev server) under Playwright |
| 2. Fix `middleware.ts` returnTo gap | `/dashboard` → `/auth/signin?returnTo=...` → back to `/dashboard` | Small but touches global auth middleware                       |
| 3. R-E1 Tuya OAuth connect spec     | Happy path + error path against the stub                          | Stub envelope shape must exactly match `tuya-http.ts` parsing  |
| 4. R-E2 auth redirect spec          | Fresh-context redirect + post-login landing assertion             | Session-cookie isolation from other specs                      |
| 5. R-E3 dashboard form specs        | Limit form + new email-form immediate-success test                | Progress bar threshold assertion depends on `hasReadings`      |

**Prerequisites:** `.env.test` populated with real `SUPABASE_URL` /
`SUPABASE_SERVICE_ROLE_KEY` for the same project as the
`kregielm@gmail.com` test user.
**Estimated effort:** ~2-3 sessions across 5 phases.

## Open Risks & Assumptions

- Assumes `SignInForm.tsx`'s `FormField` renders accessible names "Email"/
  "Password" (vs. `e2e/global-setup.ts`'s lowercase "email"/"password") —
  Phase 4 notes this must be verified against the rendered DOM before
  finalizing locators.
- Assumes the e2e test user (`kregielm@gmail.com`) has consumption readings
  for the current window (`preview.hasReadings`); if not, R-E3's
  progress-bar assertion is conditionally skipped per the plan.
- A pre-existing, unrelated `tsc` failure in `src/lib/__tests__/auth-guard.test.ts`
  (missing `cfContext` in `Locals`) is already tracked as a separate
  background task and does not block this plan.

## Success Criteria (Summary)

- `npm run test:e2e` passes from a clean checkout with zero manual setup
- A logged-out user visiting `/dashboard` is redirected to sign-in and
  returned to `/dashboard` after login
- Tuya OAuth connect (happy + error paths) is verified end-to-end against a
  local stub, without touching the real Tuya consent UI
