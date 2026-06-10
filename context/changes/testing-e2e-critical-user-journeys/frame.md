# Frame Brief: R-E1 Tuya OAuth E2E test scope

> Framing step before /10x-plan. This document captures what is _actually_
> at issue, separated from what was initially assumed.

## Reported Observation

R-E1 ("Tuya OAuth connect flow fails silently — redirect chain breaks,
callback token is not stored, meter never appears") is one of three Phase 5
E2E risks in `context/foundation/test-plan.md`. The real Tuya consent page
(`accounts.tuya.com` H5 login) presents a "slide to complete" anti-bot
verification overlay (per user-supplied screenshot) before any redirect back
to our app occurs.

## Initial Framing (preserved)

- **User's stated cause or approach**: An E2E test that drives the real Tuya
  consent UI cannot pass the slider CAPTCHA reliably — it's a genuine
  bot-detection mechanism, so the OAuth E2E test as scoped feels infeasible.
- **User's proposed direction**: Not yet stated as a concrete approach —
  flagged as a concern to resolve before planning.
- **Pre-dispatch narrowing**:
  - Q1 ("Is the CAPTCHA the only blocker, or also the server-side code
    exchange?") → **"Just the CAPTCHA/UI"**.
  - Q2 ("What's the riskiest stage if OAuth silently breaks?") →
    **"Not sure"**.

## Dimension Map

The "Tuya OAuth E2E test" framing touches four distinct stages of the start
→ callback → rehydrate chain. The observation (CAPTCHA blocks automation)
could originate at, or be conflated with, any of these:

1. **Tuya-hosted consent UI** (`accounts.tuya.com` H5 login + slider) —
   external, anti-bot by design. ← user's framing
2. **Our app's redirect/state round trip** (`src/pages/api/tuya/oauth/start.ts`
   sets `tuya_oauth_state` cookie + 302 to Tuya;
   `src/pages/dashboard/tuya/callback.astro` reads `?code&state` and renders
   `TuyaOAuthCallbackPanel`)
3. **Server-side token exchange** (`src/pages/api/tuya/oauth/callback.ts` →
   `linkTuyaAccount`/`createTuyaClient` in `src/lib/services/tuya-client.ts`,
   calling Tuya's token endpoint via `TUYA_API_BASE_URL` from inside the
   Cloudflare Worker — not the browser)
4. **Dashboard rehydration** (`TuyaConnectCard`, `useTuyaDevices` reflecting
   `tuya_oauth_tokens` / linked meter state after the callback POST resolves)

## Hypothesis Investigation

| Hypothesis                                                                                                                      | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Verdict                                                |
| ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| (1) Consent UI captcha is the only blocker                                                                                      | Screenshot shows a slider verification on Tuya's hosted login page, prior to any redirect to our app. This stage is genuinely untestable via browser automation and is explicitly out of scope per `context/foundation/test-plan.md` §7 ("Supabase/Resend internals... provider responsibilities" — same logic applies to Tuya's auth UI).                                                                                                                                                                                                                                                                                                                                                                            | STRONG (confirmed, and already correctly out of scope) |
| (2) Our redirect/state handling is independently testable                                                                       | `start.ts` sets an httpOnly `tuya_oauth_state` cookie and 302-redirects; `callback.astro` reads `code`/`state` from query params and POSTs to `/api/tuya/oauth/callback`, which validates the state cookie (`callback.ts:49-59`). None of this requires reaching `accounts.tuya.com` — a test can call `/api/tuya/oauth/start` to obtain a real state cookie, then navigate directly to `/dashboard/tuya/callback?code=<test>&state=<matching>`.                                                                                                                                                                                                                                                                      | STRONG                                                 |
| (3) Server-side token exchange (`linkTuyaAccount`) cannot be intercepted via `page.route()` as test-plan §6.5 currently implies | `callback.ts:66-79` calls `createTuyaClient(config)` and `linkTuyaAccount(...)` server-side inside the Worker — this `fetch` to Tuya's token endpoint never reaches the browser, so Playwright's `page.route()`/`waitForResponse()` (browser-level interception) cannot stub it. However, `TUYA_API_BASE_URL` is a server env var (`astro.config.mjs:116`, `tuya-config.ts:2,47`), so an E2E-specific dev-server config _could_ point it at a local stub HTTP server returning a canned token-exchange response for a known test `code`. No such stub server or webServer config currently exists (`playwright.config.ts` `webServer` is commented out; `e2e/global-setup.ts` assumes a manually-running dev server). | STRONG (gap is real; mitigation exists but is unbuilt) |
| (4) Dashboard rehydration after callback is independently testable                                                              | `TuyaConnectCard` (`src/components/tuya/TuyaConnectCard.tsx`) renders purely from `status.linked`/`tuyaUid`/`accessTokenExpiresAt` props — driven by DB state in `tuya_oauth_tokens`, not by anything Tuya-UI-specific. Once a `tuya_oauth_tokens` row exists (via stage 2+3, or seeded directly), this stage is a standard DOM-state-after-fetch assertion, same shape as R-E3.                                                                                                                                                                                                                                                                                                                                      | STRONG                                                 |

## Narrowing Signals

- User confirmed the CAPTCHA/UI is the _only_ blocker they had identified —
  meaning the server-side token-exchange interception gap (hypothesis 3) is
  a **second, independent issue** the original framing didn't surface, not
  a restatement of the CAPTCHA concern.
- `playwright.config.ts` has no `webServer` block and no env-var override
  mechanism for E2E runs today — confirming hypothesis 3's mitigation
  (stub Tuya token endpoint via `TUYA_API_BASE_URL`) is genuinely new
  infrastructure, not something already half-built and missed.
- `context/changes/tuya-read-integration/plan.md` and related Tuya change
  folders contain no prior decision about E2E-time Tuya stubbing — this is
  unexplored ground, not a previously-rejected approach.

## Cross-System Convention

Phase 1–3 integration tests already established the project's convention for
Tuya: **mock at the HTTP boundary** (`vi.spyOn(global, "fetch")` in
`@cloudflare/vitest-pool-workers`, per `context/foundation/test-plan.md` §6.2
and the `tuya-token-sync.test.ts` tests). The E2E layer needs the _same_
boundary (Tuya's token-exchange HTTP endpoint) stubbed, but from outside the
worker process — i.e., via `TUYA_API_BASE_URL` pointed at a local stub
server for the E2E run, rather than `vi.spyOn`. This is consistent with
existing convention (mock only at the network edge, never internal modules)
applied to a new execution context.

## Reframed (or Confirmed) Problem Statement

> **The actual problem to plan around is**: R-E1's E2E test should exercise
> our app's OAuth start → callback → dashboard-rehydration chain
> end-to-end (stages 2–4) against a **local stub Tuya token-exchange
> endpoint** reachable via `TUYA_API_BASE_URL`, while never navigating to
> the real `accounts.tuya.com` consent UI (stage 1, which remains correctly
> out of scope).

The user's framing ("the CAPTCHA blocks E2E") was correct as far as it went,
but incomplete: even granting that stage 1 is out of scope (which the
test-plan's §6.5 already assumes), the _current_ §6.5 wording — "intercept
the Tuya redirect at `waitForResponse()` on the callback URL" — describes a
browser-level interception technique that cannot reach the actual point of
failure risk in R-E1 (a failed/successful server-side token exchange,
stage 3). Without addressing stage 3, the E2E test can only ever exercise
the UI-rendering half of R-E1 (stage 2 redirect handling + stage 4
rehydration) using a pre-seeded DB row — which is a materially smaller test
than "the OAuth connect flow ... callback token is not stored" implies.

## Confidence

**HIGH** — direct code evidence for all four stages, confirmed env-var
hook (`TUYA_API_BASE_URL`) for the mitigation, confirmed absence of existing
stub infrastructure, and convention precedent from Phases 1–3.

## What Changes for /10x-plan

The plan for R-E1 must include a concrete decision + setup step for a local
Tuya token-exchange stub (e.g., a small fixture HTTP server or
`playwright.config.ts` `webServer`/env override pointing `TUYA_API_BASE_URL`
at it for the E2E run), in addition to the DOM-level test steps for stages
2 and 4. If that stub is judged out of scope/too costly for this phase, the
plan should explicitly document R-E1's reduced scope (UI rehydration only,
DB state pre-seeded) as a deliberate "what we don't test" addition to
test-plan §7 — rather than silently shipping a test whose name promises more
than it covers.

## References

- Source files:
  - `src/pages/api/tuya/oauth/start.ts`
  - `src/pages/dashboard/tuya/callback.astro`
  - `src/components/tuya/TuyaOAuthCallbackPanel.tsx`
  - `src/pages/api/tuya/oauth/callback.ts:66-79`
  - `src/lib/services/tuya-client.ts`
  - `src/lib/services/tuya-config.ts:2,47,79`
  - `astro.config.mjs:116`
  - `playwright.config.ts` (webServer commented out)
  - `e2e/global-setup.ts`
- Related: `context/foundation/test-plan.md` §3 Phase 5, §6.5, §7
