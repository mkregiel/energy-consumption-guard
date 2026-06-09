# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-06-09 (Phase 1 impl_reviewed — test infra + breach-to-email path)

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

| #   | Risk (failure scenario)                                                                                                                     | Impact | Likelihood | Source (evidence — not anchor)                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| R1  | Breach event is written to the database but the email dispatch job never sends the notification — user never learns their limit was crossed | High   | High       | Interview Q1; hot-spot dir `src/lib/services` (35 commits/30d); S-05 `proposed` with no tests yet                              |
| R2  | Duplicate emails sent for the same breach window — alarm spam that frustrates the user                                                      | High   | Medium     | Interview Q1; roadmap: idempotency fields exist but dispatch job untested                                                      |
| R3  | Tuya OAuth token expires silently → consumption readings stop updating → limit is never evaluated → no alarm ever fires                     | High   | Medium     | Interview Q3; hot-spot dir `src/lib/services` (35 commits/30d); roadmap: token refresh path noted as confidence gap            |
| R4  | Limit window boundary wrong → consumption sum covers wrong period → breach never triggers or triggers on every evaluation                   | High   | Medium     | Interview Q3; roadmap open question on calendar vs rolling window semantics; lessons.md: JS reduce over all readings in window |
| R5  | Cron handler throws but error is swallowed → limit evaluation never runs → silent no-alarm for arbitrary duration                           | Medium | Low        | Hot-spot `src/scheduled.ts` (2 commits/30d); Cloudflare Worker edge environment; roadmap baseline: partial observability       |
| R6  | Unauthenticated caller reads or writes `/api/limits` or `/api/notifications` configuration                                                  | Medium | Low        | PRD Access Control; roadmap baseline note: `/api/cron/` exempted from middleware — could widen surface                         |

### Risk Response Guidance

| Risk | What would prove protection                                                                                                                           | Must challenge                                                                                                                         | Context `/10x-research` must ground                                                                                                             | Likely cheapest layer                                                                                  | Anti-pattern to avoid                                                                                   |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| R1   | Breach event exists in DB AND the dispatch job calls the email sender with the correct address and breach data — not just that the event was inserted | "Breach DB insert = email will send" — dispatch is a separate scheduled job; the two steps may be decoupled                            | Entry point of the breach-notification job; how it queries `limit_breach_events`; what triggers the Resend call; how success/failure is tracked | Integration test: real job logic, stub only at the Resend HTTP boundary (ACK = done)                   | Mocking the whole email service; happy-path only; asserting row count without asserting send was called |
| R2   | A second evaluation run for the same breach window does NOT produce a second email send call                                                          | "Unique constraint on breach event prevents duplicate email" — the email dispatch job may run independently of the insert              | How the dispatch job marks a breach as notified; `notification_attempt_count` field semantics; whether the job re-queries unnotified events     | Integration test: invoke dispatch job twice for the same breach event; assert send called exactly once | Testing idempotency only at DB insert level, not at the email-send call level                           |
| R3   | An expired or invalid Tuya token triggers a refresh attempt or surfaces a clear error — not silent stale data                                         | "Last sync timestamp is recent = data is fresh" — token refresh may fail silently without updating the timestamp                       | Token refresh code path; how errors from the Tuya HTTP client propagate to the sync job; whether readings are stamped with a fetch-time         | Unit test on refresh logic + integration test with an expired-token fixture                            | Mocking Tuya client with an always-valid token; asserting only that sync ran, not that data is fresh    |
| R4   | A consumption reading timestamped just outside the configured window is excluded from the sum; a reading at the boundary is included                  | "The output looks plausible = the window arithmetic is correct"                                                                        | Window calculation in the limit-evaluation service; calendar vs rolling decision; how `window_start` is derived                                 | Unit test: boundary readings in/out of window with exact timestamps                                    | Testing only with readings all well within the window; accepting current output as oracle               |
| R5   | A cron handler that throws does NOT silently return 200 — the error propagates or is logged                                                           | "No exception thrown = evaluation succeeded"                                                                                           | Error handling in `src/scheduled.ts`; Cloudflare Worker runtime error propagation; whether the HTTP fallback surfaces errors                    | Integration test: inject a failing dependency; assert error is not swallowed                           | Catching all errors at the top level and returning 200 unconditionally                                  |
| R6   | A request to `/api/limits` or `/api/notifications` with no valid session cookie returns 401 or 403                                                    | "Global middleware protects all `/api/*` so individual handlers are safe" — verify the cron-route exemption does not widen the surface | Middleware allowlist rules; `requireUser()` placement in limit and notification handlers; which routes are actually exempt                      | Contract/integration test: unauthenticated request to each config endpoint; assert rejection           | Trusting middleware config without a negative test; testing only authenticated paths                    |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status and Change-folder as artifacts appear on disk.

| #   | Phase name                        | Goal                                                                                                                              | Risks covered | Test types                                                       | Status      | Change folder                               |
| --- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------- | ----------- | ------------------------------------------- |
| 1   | Test infra + breach-to-email path | Bootstrap Vitest + Cloudflare Workers test env; prove breach event → email dispatch is correct and called exactly once per breach | R1, R2, R5    | integration (job logic, stub at Resend ACK boundary)             | impl_reviewed | context/changes/test-infra-breach-to-email  |
| 2   | Window boundary + idempotency     | Prove limit window sum uses correct time boundaries; prove no duplicate emails are sent for the same window                       | R2, R4        | unit (boundary arithmetic), integration (duplicate-run scenario) | shipped     | context/changes/window-boundary-idempotency |
| 3   | Tuya sync resilience              | Prove token refresh fires on expiry; stale-reading detection surfaces an error, not silent success                                | R3            | unit (token refresh logic), integration (expired-token fixture)  | not started | —                                           |
| 4   | Auth boundary + CI gate           | Prove unauthenticated requests to config endpoints are rejected; wire all tests into GitHub Actions CI on PR                      | R6            | contract/integration (negative auth), CI config                  | not started | —                                           |

## 4. Stack

The project currently has **no test infrastructure** (test-base profile: `none` — no vitest.config, no test files found as of 2026-06-05). Phase 1 bootstraps the runner.

| Layer              | Tool                               | Version              | Notes                                                                                                                                                      |
| ------------------ | ---------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit + integration | Vitest                             | TBD — see §3 Phase 1 | Recommended for Astro/TS projects on Cloudflare Workers; `@cloudflare/vitest-pool-workers` for Worker env                                                  |
| Worker integration | `@cloudflare/vitest-pool-workers`  | TBD — see §3 Phase 1 | Runs test workers in real miniflare environment; needed for cron handler tests                                                                             |
| HTTP mocking       | MSW or `vi.fn()` at fetch boundary | TBD — see §3 Phase 1 | Mock Resend and Tuya HTTP at the network edge only; never mock internal modules                                                                            |
| e2e                | Playwright (`@playwright/test`)    | ^1.60.0              | Integrated via `playwright.config.ts` (testDir `e2e/`, chromium/firefox/webkit projects); not yet wired into a rollout phase — see `/10x-e2e` for workflow |

**Stack grounding tools (current session):**

- Docs: none — no Context7 or framework docs MCP available in this session; checked: 2026-06-05
- Search: WebSearch available (deferred tool) — not used for stack grounding; checked: 2026-06-05
- Runtime/browser: Claude in Chrome MCP available — not used (no e2e phase planned); checked: 2026-06-05
- Provider/platform: no Supabase/Cloudflare MCP detected — not used; checked: 2026-06-05

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

### 6.5 Per-rollout-phase notes

(Filled in as phases ship.)

## 7. What We Deliberately Don't Test

- **Resend internals past ACK** — if the provider acknowledges the send task, the application's responsibility ends there. Test that the send call is made with correct arguments; do not simulate Resend delivery failures or bounces. Re-evaluate if Resend SLA becomes a support issue. (Source: Phase 2 interview Q5.)
- **Supabase internals** — RLS policies, Supabase auth internals, and Postgres query execution are provider responsibilities. Test that the application sends the right query/mutation; do not test Supabase itself. Re-evaluate if a Supabase upgrade breaks application behavior. (Source: Phase 2 interview Q5.)
- **Dashboard layout and styling** — pure presentation with no computed logic; low blast radius. Re-evaluate if a UI regression surfaces in production. (Source: test-base profile `none`; cost × signal principle.)
- **Tuya device list display** — passthrough render of API response; nothing computed. Re-evaluate if display logic is added. (Source: cost × signal principle.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-05
- Stack versions last verified: 2026-06-05
- AI-native tool references last verified: 2026-06-05

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer reflects what the team believes.
