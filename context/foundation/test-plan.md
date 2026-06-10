# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-06-09 (Phases 1 + 2 shipped; MCP stack updated; Phase 5 E2E added: R-E1 Tuya OAuth, R-E2 auth redirect, R-E3 form round-trip)

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the
   team is worried about X, and the failure would surface somewhere in
   an area" carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents _what
   could fail_ and _why we believe it's likely_ — drawn from documents,
   interview, and codebase _signal_ (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/` (excluding `node_modules`, `dist`, `.next`). Top churn directory last 30 days: `src/lib/services` (35 touches).

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the _evidence that surfaced
this risk_ — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| #    | Risk (failure scenario)                                                                                                                     | Impact | Likelihood | Source (evidence — not anchor)                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| R1   | Breach event is written to the database but the email dispatch job never sends the notification — user never learns their limit was crossed | High   | High       | Interview Q1; hot-spot dir `src/lib/services` (35 commits/30d); S-05 `proposed` with no tests yet                               |
| R2   | Duplicate emails sent for the same breach window — alarm spam that frustrates the user                                                      | High   | Medium     | Interview Q1; roadmap: idempotency fields exist but dispatch job untested                                                       |
| R3   | Tuya OAuth token expires silently → consumption readings stop updating → limit is never evaluated → no alarm ever fires                     | High   | Medium     | Interview Q3; hot-spot dir `src/lib/services` (35 commits/30d); roadmap: token refresh path noted as confidence gap             |
| R4   | Limit window boundary wrong → consumption sum covers wrong period → breach never triggers or triggers on every evaluation                   | High   | Medium     | Interview Q3; roadmap open question on calendar vs rolling window semantics; lessons.md: JS reduce over all readings in window  |
| R5   | Cron handler throws but error is swallowed → limit evaluation never runs → silent no-alarm for arbitrary duration                           | Medium | Low        | Hot-spot `src/scheduled.ts` (2 commits/30d); Cloudflare Worker edge environment; roadmap baseline: partial observability        |
| R6   | Unauthenticated caller reads or writes `/api/limits` or `/api/notifications` configuration                                                  | Medium | Low        | PRD Access Control; roadmap baseline note: `/api/cron/` exempted from middleware — could widen surface                          |
| R-E1 | Tuya OAuth connect flow fails silently in the browser — redirect chain breaks, callback token is not stored, meter never appears in the app | High   | Medium     | FR-002; OAuth H5 redirect chain is browser-only; unit/integration tests cannot exercise cookie state across redirect boundaries |
| R-E2 | Unauthenticated visit to `/dashboard` does not redirect to login — or post-login does not land on dashboard — breaking the auth UX          | Medium | Low        | FR-001; session cookie + browser redirect behaviour is distinct from the API-level 401 covered by Phase 4                       |
| R-E3 | Limit form or alarm-email form saves successfully at the API level but the dashboard renders stale values — user sees no confirmation       | Medium | Low        | FR-003, FR-004; client-side re-render and progress bar state after POST are invisible to integration tests                      |

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                           | Must challenge                                                                                                                         | Context `/10x-research` must ground                                                                                                              | Likely cheapest layer                                                                                       | Anti-pattern to avoid                                                                                   |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| R1   | Breach event exists in DB AND the dispatch job calls the email sender with the correct address and breach data — not just that the event was inserted | "Breach DB insert = email will send" — dispatch is a separate scheduled job; the two steps may be decoupled                            | Entry point of the breach-notification job; how it queries `limit_breach_events`; what triggers the Resend call; how success/failure is tracked  | Integration test: real job logic, stub only at the Resend HTTP boundary (ACK = done)                        | Mocking the whole email service; happy-path only; asserting row count without asserting send was called |
| R2   | A second evaluation run for the same breach window does NOT produce a second email send call                                                          | "Unique constraint on breach event prevents duplicate email" — the email dispatch job may run independently of the insert              | How the dispatch job marks a breach as notified; `notification_attempt_count` field semantics; whether the job re-queries unnotified events      | Integration test: invoke dispatch job twice for the same breach event; assert send called exactly once      | Testing idempotency only at DB insert level, not at the email-send call level                           |
| R3   | An expired or invalid Tuya token triggers a refresh attempt or surfaces a clear error — not silent stale data                                         | "Last sync timestamp is recent = data is fresh" — token refresh may fail silently without updating the timestamp                       | Token refresh code path; how errors from the Tuya HTTP client propagate to the sync job; whether readings are stamped with a fetch-time          | Unit test on refresh logic + integration test with an expired-token fixture                                 | Mocking Tuya client with an always-valid token; asserting only that sync ran, not that data is fresh    |
| R4   | A consumption reading timestamped just outside the configured window is excluded from the sum; a reading at the boundary is included                  | "The output looks plausible = the window arithmetic is correct"                                                                        | Window calculation in the limit-evaluation service; calendar vs rolling decision; how `window_start` is derived                                  | Unit test: boundary readings in/out of window with exact timestamps                                         | Testing only with readings all well within the window; accepting current output as oracle               |
| R5   | A cron handler that throws does NOT silently return 200 — the error propagates or is logged                                                           | "No exception thrown = evaluation succeeded"                                                                                           | Error handling in `src/scheduled.ts`; Cloudflare Worker runtime error propagation; whether the HTTP fallback surfaces errors                     | Integration test: inject a failing dependency; assert error is not swallowed                                | Catching all errors at the top level and returning 200 unconditionally                                  |
| R6   | A request to `/api/limits` or `/api/notifications` with no valid session cookie returns 401 or 403                                                    | "Global middleware protects all `/api/*` so individual handlers are safe" — verify the cron-route exemption does not widen the surface | Middleware allowlist rules; `requireUser()` placement in limit and notification handlers; which routes are actually exempt                       | Contract/integration test: unauthenticated request to each config endpoint; assert rejection                | Trusting middleware config without a negative test; testing only authenticated paths                    |
| R-E1 | Tuya OAuth button triggers the redirect chain, callback stores the token, and the connected meter appears in the device list without a page reload    | "API returns 200 = OAuth worked" — token storage and UI update happen across a redirect boundary that integration tests cannot cross   | Tuya OAuth entry point in the UI; callback route and how it writes the token; how the device list re-fetches or rehydrates after the callback    | E2E: navigate to connect flow, complete OAuth (or intercept redirect), assert meter visible in device list  | Mocking the entire OAuth flow at fetch level; asserting only API response, not rendered device list     |
| R-E2 | Visiting `/dashboard` without a session redirects to `/login`; completing login lands back on `/dashboard`                                            | "Middleware returns 302 = UX is correct" — browser cookie jar and redirect chain behaviour differs from a raw HTTP check               | `src/middleware.ts` redirect logic; post-login redirect target; how Supabase session cookie is set and read across navigations                   | E2E: navigate to `/dashboard` unauthenticated → assert URL is `/login`; log in → assert URL is `/dashboard` | Testing only the API 401, not the rendered redirect; skipping the post-login landing assertion          |
| R-E3 | After submitting the limit form and the email form, the dashboard immediately shows the saved values and the progress bar reflects the new limit      | "POST returns 200 = UI updated" — client-side re-render after form submission may read stale cache or skip a refetch                   | How each form triggers a data refetch or optimistic update after POST; whether the progress bar reads from server state or component-local state | E2E: fill and submit each form; assert updated values visible in the UI without a full page reload          | Only asserting the POST response; not asserting the rendered dashboard state after submission           |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status and Change-folder as artifacts appear on disk.

| #   | Phase name                        | Goal                                                                                                                              | Risks covered    | Test types                                                       | Status      | Change folder                               |
| --- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------- | ----------- | ------------------------------------------- |
| 1   | Test infra + breach-to-email path | Bootstrap Vitest + Cloudflare Workers test env; prove breach event → email dispatch is correct and called exactly once per breach | R1, R2, R5       | integration (job logic, stub at Resend ACK boundary)             | shipped     | context/changes/test-infra-breach-to-email  |
| 2   | Window boundary + idempotency     | Prove limit window sum uses correct time boundaries; prove no duplicate emails are sent for the same window                       | R2, R4           | unit (boundary arithmetic), integration (duplicate-run scenario) | shipped     | context/changes/window-boundary-idempotency |
| 3   | Tuya sync resilience              | Prove token refresh fires on expiry; stale-reading detection surfaces an error, not silent success                                | R3               | unit (token refresh logic), integration (expired-token fixture)  | shipped     | context/changes/tuya-sync-resilience        |
| 4   | Auth boundary + CI gate           | Prove unauthenticated requests to config endpoints are rejected; wire all tests into GitHub Actions CI on PR                      | R6               | contract/integration (negative auth), CI config                  | not started | —                                           |
| 5   | E2E critical user journeys        | Prove Tuya OAuth connect flow, auth redirect behaviour, and limit/email config round-trip work in a real browser                  | R-E1, R-E2, R-E3 | e2e (Playwright, DOM snapshot)                                   | not started | —                                           |

## 4. Stack

Test infrastructure is **active** (bootstrapped in Phase 1 — shipped 2026-06-08). `vitest.config.ts` + `vitest.workers.config.ts` present; 3 test files in `src/lib/services/__tests__/`.

| Layer              | Tool                              | Version                        | Notes                                                                                                                                                 |
| ------------------ | --------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit + integration | Vitest                            | see `vitest.config.ts`         | Active — `vitest.config.ts` for unit/service tests; `@/` alias wired via `resolve.alias`                                                              |
| Worker integration | `@cloudflare/vitest-pool-workers` | see `vitest.workers.config.ts` | Active — real miniflare environment; used for cron handler + breach-notification integration tests                                                    |
| HTTP mocking       | `vi.fn()` at fetch boundary       | n/a (no MSW)                   | `vi.spyOn(global, "fetch")` pattern established in breach-notifications tests; mock Resend and Tuya at network edge only; never mock internal modules |
| e2e                | Playwright (`@playwright/test`)   | ^1.60.0                        | Integrated via `playwright.config.ts` (testDir `e2e/`, chromium/firefox/webkit projects); Phase 5 — drive via `/10x-e2e` skill                        |

**Stack grounding tools (current session):**

- Docs: **context7 MCP active** (`mcp__context7__query-docs` / `resolve-library-id`) — use for Vitest, Cloudflare Workers, MSW, Astro docs; checked: 2026-06-09
- Search: WebSearch available (deferred tool) — fallback when context7 has no match; checked: 2026-06-09
- Runtime/browser: Claude in Chrome MCP available — not used (no e2e phase planned); checked: 2026-06-09
- Provider/platform: **Supabase MCP active** (`mcp__supabase__*`) — use for schema inspection, SQL execution, migration listing; checked: 2026-06-09
- Provider/platform: **Cloudflare MCP active** (`mcp__cloudflare__*`) — use for Workers config, KV, D1, deploy queries; checked: 2026-06-09

## 5. Quality Gates

| Gate                    | Where                | Required?                 | Catches                                                                       |
| ----------------------- | -------------------- | ------------------------- | ----------------------------------------------------------------------------- |
| lint + typecheck        | local + CI           | required now              | syntactic / type drift                                                        |
| unit + integration      | local + CI           | required after §3 Phase 1 | logic regressions in breach path, window arithmetic, Tuya sync                |
| auth boundary tests     | local + CI           | required after §3 Phase 4 | unauthenticated config-endpoint access                                        |
| pre-prod smoke (manual) | between merge + prod | recommended               | environment-specific failures (Worker cron, Resend key, Supabase RLS in prod) |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section fills in once the relevant rollout phase ships.

### 6.1 Adding a unit test

Reference file: `src/lib/services/__tests__/consumption-window.test.ts`

**File location**: Place unit tests in `src/lib/services/__tests__/<module-name>.test.ts`.

**Import style**: Use the `@/` alias for all production imports (`import { getWindowBounds } from "@/lib/services/consumption-window"`). The alias is wired in `vitest.config.ts` → `resolve.alias`.

**Fixture approach — oracle first, not output-recorded**:

1. Identify the function's explicit input knobs (e.g., `referenceDate?: Date`). If the function does not accept one, add it or test through a thin wrapper — this keeps fixtures timezone-independent.
2. Derive `expected*` values from calendar rules / PRD / domain knowledge **before** running the code. Do not run the function, copy the output, and call that the oracle — that produces a mirror test that passes against bugs.
3. Express fixtures as UTC ISO strings so the test results are the same regardless of the CI machine's local timezone.

**`it.each` for parameterised boundary cases**:

```ts
it.each([
  {
    label: "day window — CEST",
    windowType: "day",
    referenceDate: "2026-06-15T10:00:00.000Z",
    expectedStart: "2026-06-14T22:00:00.000Z",
    expectedEnd: "2026-06-15T22:00:00.000Z",
  },
  {
    label: "DST spring-forward",
    windowType: "day",
    referenceDate: "2026-03-29T10:00:00.000Z",
    expectedStart: "2026-03-28T23:00:00.000Z",
    expectedEnd: "2026-03-29T22:00:00.000Z",
  },
  // … one row per regression you want to catch
])("$label", ({ windowType, referenceDate, expectedStart, expectedEnd }) => {
  const result = getWindowBounds(windowType, "Europe/Warsaw", new Date(referenceDate));
  expect(result.windowStart.toISOString()).toBe(expectedStart);
  expect(result.windowEnd.toISOString()).toBe(expectedEnd);
});
```

Each row must exercise a **different regression** (different window type, DST vs non-DST, etc.). Duplicate rows that assert the same property catch nothing extra.

**`astro:env/server` in unit tests**: If the module under test imports (directly or transitively) from `astro:env/server`, mock it at the top level with `vi.mock('@/lib/services/<module>', () => ({ ... }))`. Vitest auto-hoists top-level `vi.mock` calls before any imports are evaluated, preventing the virtual module from being resolved. The `vitest.config.ts` also ships a belt-and-suspenders shim plugin for tests that do not mock the boundary.

**Untyped Supabase returns**: When using the untyped Supabase client in helper code, satisfy `@typescript-eslint/no-unsafe-assignment` with an explicit inline assertion: `(data as { id: string }).id`.

### 6.2 Adding an integration test for a background job

TBD — see §3 Phase 1. Pattern: real job logic invoked in a `@cloudflare/vitest-pool-workers` env; stub only at the Resend HTTP boundary and Tuya HTTP boundary. Assert both the DB side-effect AND the external call.

**Config-boundary mocking**: `tuya-config` (env-var → config-object adapter, no business logic) may also be mocked alongside the `tuya-http` transport — e.g. to keep tests independent of `.env.test`'s `TUYA_*` vars, or to control `getMissingTuyaConfigKeys()` for fatal-config-error scenarios (see `tuya-token-sync.test.ts` T4). This is a config boundary, not an internal business-logic module, so it does not violate the "mock only at the network boundary" rule. Do not mock `tuya-client`, `cron-sync`, or `scheduled` themselves.

### 6.3 Adding a test for a new limit or window calculation

Reference files: `src/lib/services/__tests__/consumption-window.test.ts`, `src/lib/services/__tests__/consumption-preview-predicate.test.ts`

Use a **two-layer approach**: one layer for boundary arithmetic, one for predicate operators. Both are unit tests; neither needs a running database.

#### Layer 1 — Boundary arithmetic (test `getWindowBounds()` directly)

Test the calendar function in isolation with an explicit `referenceDate` — do not route through the evaluation service. This keeps the fixture table simple and makes failures easy to diagnose.

Oracle values for common European/Warsaw offsets:

| Season                          | UTC offset          | midnight Warsaw in UTC      |
| ------------------------------- | ------------------- | --------------------------- |
| CEST (summer)                   | UTC+2               | `T22:00:00.000Z` day before |
| CET (winter)                    | UTC+1               | `T23:00:00.000Z` day before |
| DST spring-forward day (Mar 29) | start CET, end CEST | 23-hour window              |

**Always include a DST fixture**. The spring-forward day in the Warsaw timezone is March 29 (clocks jump at 02:00 CET → 03:00 CEST). On that day the `day` window is 23 hours, not 24:

```
referenceDate: "2026-03-29T10:00:00.000Z"
expectedStart: "2026-03-28T23:00:00.000Z"  // midnight CET = UTC-1h
expectedEnd:   "2026-03-29T22:00:00.000Z"  // midnight CEST = UTC-2h
```

In addition to the parameterised arithmetic tests, add three standalone half-open interval semantics assertions (using any fixture as the vehicle):

```ts
it("windowStart is included in the window", () => {
  expect(start.getTime() >= start.getTime()).toBe(true);
});
it("windowEnd is excluded from the window", () => {
  expect(end.getTime() < end.getTime()).toBe(false);
});
it("one millisecond before windowStart is excluded", () => {
  expect(start.getTime() - 1 < start.getTime()).toBe(true);
});
```

These three pin the `>=`/`<` semantics. A future change to `>`/`<=` fails them immediately.

#### Layer 2 — Predicate operators (recording mock on the Supabase query builder)

Boundary arithmetic alone does not catch a `>` vs `>=` typo in the query that filters readings. Add a separate test that builds a recording Supabase client, calls the preview/evaluation function, and asserts which filter methods were called:

```ts
// Minimal recording builder — thenable so Supabase lazy-chain resolves
const calls: { method: string; column: string }[] = [];
const builder: Record<string, unknown> = {
  gte: (col: string) => {
    calls.push({ method: "gte", column: col });
    return builder;
  },
  gt: (col: string) => {
    calls.push({ method: "gt", column: col });
    return builder;
  },
  lt: (col: string) => {
    calls.push({ method: "lt", column: col });
    return builder;
  },
  lte: (col: string) => {
    calls.push({ method: "lte", column: col });
    return builder;
  },
  then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
  // … add select, eq, etc. as needed by the function under test
};
```

Assert:

- A `gte` call was recorded for column `"recorded_at"`.
- A `lt` call was recorded for column `"recorded_at"`.
- No `gt` or `lte` call for `"recorded_at"`.

This test fails immediately if the wrong operator pair is used, even when no fixture reading sits exactly on the boundary.

### 6.4 Adding a test for a new API endpoint

TBD — see §3 Phase 4. Pattern: integration test — unauthenticated request → assert 401/403; authenticated request → assert response shape and DB side-effect.

### 6.5 Adding an E2E test (Phase 5)

Drive via `/10x-e2e`. Each test maps to one risk (R-E1, R-E2, R-E3); seed file lives in `e2e/`.

**Locator priority** (per CLAUDE.md): `getByRole` / `getByLabel` / `getByText` first; `getByTestId` only when accessibility attributes are ambiguous. Never CSS selectors or XPath.

**No `waitForTimeout`** — wait for state: `toBeVisible()`, `waitForURL()`, `waitForResponse()`.

**Test independence** — each test owns its own setup, action, assertion, and cleanup. Use timestamp-suffixed unique data so parallel runs don't collide.

**OAuth (R-E1)** — intercept the Tuya redirect at `waitForResponse()` on the callback URL rather than driving the external Tuya UI. Assert the meter row is visible in the device list after the callback resolves.

**Auth redirect (R-E2)** — use a fresh browser context with no stored session to guarantee no cookie leakage from other tests.

**Form round-trip (R-E3)** — assert the updated value is visible in the DOM after the POST response, not just that the form submitted successfully.

### 6.6 Per-rollout-phase notes

(Filled in as phases ship.)

## 7. What We Deliberately Don't Test

- **Resend internals past ACK** — if the provider acknowledges the send task, the application's responsibility ends there. Test that the send call is made with correct arguments; do not simulate Resend delivery failures or bounces. Re-evaluate if Resend SLA becomes a support issue. (Source: Phase 2 interview Q5.)
- **Supabase internals** — RLS policies, Supabase auth internals, and Postgres query execution are provider responsibilities. Test that the application sends the right query/mutation; do not test Supabase itself. Re-evaluate if a Supabase upgrade breaks application behavior. (Source: Phase 2 interview Q5.)
- **Dashboard layout and styling** — pure presentation with no computed logic; low blast radius. Re-evaluate if a UI regression surfaces in production. (Source: test-base profile `none`; cost × signal principle.)
- **Tuya device list display** — passthrough render of API response; nothing computed. Re-evaluate if display logic is added. (Source: cost × signal principle.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-09
- Stack versions last verified: 2026-06-09 (Vitest active; vitest.config.ts + vitest.workers.config.ts confirmed on disk)
- AI-native tool references last verified: 2026-06-09 (context7, supabase, cloudflare MCPs installed and active)

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer reflects what the team believes.
