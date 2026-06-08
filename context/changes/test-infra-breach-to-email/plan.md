# Test Infra (Workers Pool) + Breach-to-Email Risk Coverage Implementation Plan

## Overview

Close the genuine remaining gaps in `test-plan.md` Phase 1 ("Test infra + breach-to-email path", risks R1/R2/R5) without re-doing work `window-boundary-idempotency` already shipped: add `@cloudflare/vitest-pool-workers` for Workers-runtime parity, migrate the breach-notification test suite onto it, then add integration coverage for the retry/terminal-failure path and the Resend HTTP-error path — the two risk-bearing behaviors that are currently untested at any level.

## Current State Analysis

`window-boundary-idempotency` (status: done) already bootstrapped Vitest end-to-end: [`vitest.config.ts`](vitest.config.ts:1) (Node environment, `@/` alias, `astro:env/server` virtual-module shim, `.env.test` convention via [`vitest.setup.ts`](vitest.setup.ts:1)), npm scripts (`package.json:6-8`), and three test files in `src/lib/services/__tests__/`. Crucially, [`breach-notifications-idempotency.test.ts`](src/lib/services/__tests__/breach-notifications-idempotency.test.ts:1) already runs `runBreachNotifications()` against a real local Supabase instance (service-role client, bypasses RLS) with `email-client` module-mocked via hoisted `vi.mock()`, and proves the "exactly once per breach" guarantee for the sequential case — which is what Phase 1's description literally asks for.

What remains genuinely untested:

- **Runtime parity**: tests run in plain `node`, not the Cloudflare Workers runtime the job actually deploys to (`wrangler.jsonc:5` → `compatibility_date: "2026-05-08"`, `compatibility_flags: ["nodejs_compat"]`).
- **Retry/terminal-failure path**: [`markBreachNotified`](src/lib/services/breach-notifications.ts:86) and the surrounding loop increment `notification_attempt_count` and set `notification_failed_at` after the 3rd failed send — no test exercises this.
- **Resend HTTP-error path**: [`sendPlainTextEmail`](src/lib/services/email-client.ts:5) throws on non-2xx; no test proves the job catches that and records the failure correctly.

The concurrent-race gap (two dispatchers racing the same unnotified row) remains a deliberately accepted MVP limitation per two prior plans — out of scope here.

## Desired End State

- `@cloudflare/vitest-pool-workers` is installed and configured as the execution environment for the breach-job test suite; `npm run test:ci` runs that suite inside a Workers-compatible runtime and it stays green.
- The existing two idempotency tests in `breach-notifications-idempotency.test.ts` continue to pass unchanged in behavior (their assertions, not their environment, are the contract).
- Two new integration tests prove: (a) after 3 failed send attempts, `notification_attempt_count` reaches 3 and `notification_failed_at` is set, and the breach is excluded from subsequent runs; (b) when `sendPlainTextEmail` rejects with a Resend-style HTTP error, the job catches it, increments the attempt counter, and does not crash the run.

### Key Discoveries:

- The mocking convention to extend is the **hoisted `vi.mock('@/lib/services/email-client', ...)`** at [`breach-notifications-idempotency.test.ts:7-10`](src/lib/services/__tests__/breach-notifications-idempotency.test.ts:7) — both new tests reuse this, just changing the mock's resolved/rejected value per test.
- Fixture lifecycle is **real Supabase, not mocks**: `beforeAll`/`afterAll` create/delete a real auth user (cascades), `beforeEach` inserts `consumption_limits` → `limit_breach_events` → `notification_settings` in FK order ([`breach-notifications-idempotency.test.ts:89-125`](src/lib/services/__tests__/breach-notifications-idempotency.test.ts:89)).
- The `astro:env/server` virtual-module shim in [`vitest.config.ts:8-38`](vitest.config.ts:8) is the load-bearing piece that makes any of this run outside Astro — it must keep working under the Workers pool, or be reconciled with the pool's own environment-variable/binding mechanism.
- `wrangler.jsonc` declares no bindings beyond `ASSETS` (`wrangler.jsonc:7-11`) — the Workers pool config needs no binding wiring for this suite, only `compatibility_date`/`compatibility_flags` parity and a way to inject the same `.env.test` values (likely via the pool's `miniflare` `bindings` or `vars` option, mirroring what `vitest.setup.ts` currently does for `process.env`).
- `sendPlainTextEmail` calls Resend via raw `fetch` (not the SDK) specifically to avoid `workerd` friction ([`email-client.ts:5-29`](src/lib/services/email-client.ts:5)) — this was a deliberate choice anticipating exactly the runtime this phase now adds test coverage for.

## What We're NOT Doing

- Not re-bootstrapping Vitest, npm scripts, or the `astro:env/server` shim — they exist and work.
- Not writing a new happy-path or sequential-idempotency test — `breach-notifications-idempotency.test.ts` already covers that ground; we migrate it, we don't duplicate it.
- Not testing or fixing the concurrent-race gap — accepted MVP limitation per `email-alarm-on-limit-breach/plan.md` and `window-boundary-idempotency/plan.md`; revisiting it would be a scope change to those decisions, not a gap-fill.
- Not adding a unit test for `email-client.ts`'s own `fetch`-to-throw translation (mocking global `fetch`) — the chosen approach tests the _job's_ handling of a rejected `sendPlainTextEmail`, which is the risk-bearing behavior; the narrower HTTP-translation unit is a separate, lower-priority concern.
- Not migrating `consumption-window.test.ts` or `consumption-preview-predicate.test.ts` to the Workers pool — they're pure-function/predicate unit tests with no Workers-runtime dependency; only the breach-job integration suite needs runtime parity.

## Implementation Approach

Three phases, ordered so the highest-priority infra milestone (Workers pool parity, called out explicitly in `test-plan.md` §4) lands first and is verified stable before new test cases are layered on top of it — de-risking the migration before it has more tests to carry. Phases 2 and 3 then each add exactly one integration test, reusing the established hoisted-mock + real-local-Supabase pattern, varying only the mock's behavior (reject-N-times vs reject-once-with-HTTP-error-shape).

## Critical Implementation Details

**Workers pool ↔ `astro:env/server` shim reconciliation**: `vitest.config.ts` currently injects the shim and loads `.env.test` via a custom `setup()` in `vitest.setup.ts` that writes into `process.env` before workers spin up (see the comment at [`vitest.setup.ts:7`](vitest.setup.ts:7): "This runs in the global setup context (before workers spin up)" — a pre-existing acknowledgment that a worker-pool model was anticipated). Under `@cloudflare/vitest-pool-workers`, each test file runs in an isolated `workerd` instance that does **not** inherit `process.env` the same way Node does — environment values must be passed through the pool's `miniflare`/`bindings`/`vars` configuration instead. The implementer must verify which mechanism actually delivers `RESEND_API_KEY`, `SUPABASE_URL`, etc. into the worker's `astro:env/server` shim at runtime, and adjust the shim or the pool config accordingly — this is the one piece of this migration that can silently break the suite (tests would fail with "module not found" or `undefined` env values, not a clear pool-setup error).

## Phase 1: Add Workers pool and migrate the breach-job suite

### Overview

Install `@cloudflare/vitest-pool-workers`, give the breach-job suite its own Vitest project/config running under that pool with `wrangler.jsonc`-matching `compatibility_date`/`compatibility_flags`, reconcile environment-variable delivery (see Critical Implementation Details), and confirm the two existing idempotency tests pass unchanged under the new runtime.

### Changes Required:

#### 1. Install the pool dependency

**File**: `package.json`

**Intent**: Add `@cloudflare/vitest-pool-workers` as a devDependency so the breach-job suite can run in a Workers-compatible runtime, matching the deployed environment.

**Contract**: New entry in `devDependencies`, version compatible with the existing `vitest@^3.0.0` and `wrangler@^4.90.0`.

#### 2. Configure the Workers-pool execution environment for the breach-job suite

**File**: `vitest.config.ts` (extend; add a sibling config or a `projects`/`workspace` entry if a single config can't cleanly run two pools side by side — implementer's call based on what Vitest 3's API supports cleanly)

**Intent**: Scope `breach-notifications-idempotency.test.ts` (and the two new test files from Phases 2-3) to run under `@cloudflare/vitest-pool-workers`, configured with `compatibility_date`/`compatibility_flags` mirroring `wrangler.jsonc:5-6`, while leaving the pure-unit suites (`consumption-window`, `consumption-preview-predicate`) on the existing `node` environment untouched.

**Contract**: The pool config must (a) target only the breach-job test file glob, (b) set `compatibilityDate: "2026-05-08"` and `compatibilityFlags: ["nodejs_compat"]` to match `wrangler.jsonc`, and (c) deliver the same environment values that `.env.test` currently provides via `vitest.setup.ts`'s `process.env` injection — through whatever mechanism the pool exposes for bindings/vars (resolve per the Critical Implementation Details note; this is the one genuinely open integration question the implementer must close empirically, not a pre-decided answer).

#### 3. Reconcile the `astro:env/server` shim for the Workers runtime

**File**: `vitest.config.ts` (the existing virtual-module shim at lines 8-38) and/or a pool-specific equivalent

**Intent**: Ensure code under test that imports from `astro:env/server` (e.g. `email-client.ts:1`, `breach-notifications.ts` transitively, `cron-auth.ts:2`) resolves correctly when executed inside the `workerd` runtime, not just in Node.

**Contract**: The shim's resolved values must be sourced from whatever the pool delivers as the worker's environment (bindings/vars), not from Node's `process.env` directly — verify empirically which one `@cloudflare/vitest-pool-workers` exposes to a virtual-module plugin and wire accordingly.

### Success Criteria:

#### Automated Verification:

- Dependency installs cleanly: `npm install`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- The migrated breach-job suite passes under the Workers pool: `npm run test:ci -- breach-notifications-idempotency`
- Both pre-existing tests in that file still pass with their original assertions intact (no assertion changes — only the execution environment changed)

#### Manual Verification:

- Run the full suite (`npm run test:ci`) and confirm the pure-unit suites (`consumption-window`, `consumption-preview-predicate`) still run under `node` and pass — the pool split didn't regress them
- Inspect test output/logs to confirm the breach-job suite is actually executing inside `workerd` (not silently falling back to `node`) — e.g. via pool-specific log markers or a deliberate runtime-only assertion (`typeof caches !== "undefined"` or similar Workers-only global) added temporarily during verification

---

## Phase 2: Retry / terminal-failure path coverage

### Overview

Add an integration test proving that after 3 consecutive failed send attempts for the same breach, `notification_attempt_count` reaches 3, `notification_failed_at` is set (terminal), and the breach is excluded from subsequent `runBreachNotifications()` calls.

### Changes Required:

#### 1. New test case in the breach-job suite

**File**: `src/lib/services/__tests__/breach-notifications-idempotency.test.ts` (add alongside the existing two tests, sharing the `describe` block and fixture setup) — or a sibling file `breach-notifications-retry.test.ts` if the implementer judges the fixture setup is cleaner duplicated than shared; match whichever existing convention reads more naturally once the Phase 1 file structure is settled.

**Intent**: Reuse the hoisted `vi.mock('@/lib/services/email-client', ...)` pattern, but make `sendPlainTextEmail` reject on each call for a given test, then run `runBreachNotifications()` three times (mirroring the cron's hourly cadence) and assert the DB row's `notification_attempt_count` and `notification_failed_at` reach the terminal state after the 3rd run, and a 4th run no longer attempts to send for that breach.

**Contract**: Per-test override of the mocked `sendPlainTextEmail` to `mockRejectedValue(new Error(...))` (Vitest supports per-test `mockImplementationOnce`/`mockRejectedValueOnce` chains, or resetting the mock's behavior in that test's setup) — assert against the real DB row fetched via the service-role client, matching the existing tests' assertion style (query the row directly rather than trusting in-memory state).

### Success Criteria:

#### Automated Verification:

- New test passes: `npm run test:ci -- breach-notifications`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Existing two idempotency tests remain green (no regression from shared fixture changes, if any)

#### Manual Verification:

- Review the test's assertions against the actual `markBreachNotified`/attempt-recording logic in `breach-notifications.ts:86-119` to confirm the terminal-state condition (3 attempts → `notification_failed_at` set) is asserted precisely as the production code implements it, not as an assumption

---

## Phase 3: Resend HTTP-error path coverage

### Overview

Add an integration test proving that when the email send fails with a Resend-style HTTP error (the shape `sendPlainTextEmail` throws on non-2xx — see `email-client.ts:24-28`), the job catches it, records the failure (increments `notification_attempt_count`, does not mark `notified_at`), and the run completes without crashing or losing track of other breaches in the batch.

### Changes Required:

#### 1. New test case in the breach-job suite

**File**: Same file/location decided in Phase 2 (keep the retry and HTTP-error tests adjacent — they exercise the same failure-recording code path from different trigger shapes)

**Intent**: Mock `sendPlainTextEmail` to reject once with an `Error` whose message mirrors the shape `email-client.ts:24-28` produces on a non-2xx Resend response (HTTP status + truncated body), run `runBreachNotifications()`, and assert the job (a) catches the rejection without throwing out of the batch loop, (b) records exactly one failed attempt on that breach's row, and (c) — if the test fixture includes a second, independent breach — still successfully notifies that other breach in the same run (proving one failure doesn't poison the batch).

**Contract**: `mockRejectedValueOnce(new Error("Resend send failed: 422 ..."))` (or equivalent), assertions against the real DB row for both the failing and (if included) succeeding breach, matching the query-the-row style of the existing tests.

### Success Criteria:

#### Automated Verification:

- New test passes: `npm run test:ci -- breach-notifications`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- All prior tests in the suite (idempotency + retry/terminal-failure) remain green

#### Manual Verification:

- Confirm the test's mocked error message shape genuinely mirrors what `email-client.ts:24-28` produces for a real non-2xx Resend response (read the production error-construction code side-by-side with the test's mock to verify they're not testing an imagined shape)
- Confirm via `npm run test:ci` that the full suite — pure-unit (node) + breach-job (Workers pool) — runs cleanly end to end

---

## Testing Strategy

### Unit Tests:

- No new pure-unit tests in this plan — the remaining gaps (retry/terminal-failure, HTTP-error handling) are integration-shaped: they depend on real DB state transitions (`notification_attempt_count`, `notification_failed_at`) that a unit test would have to fake, defeating the point of proving them.

### Integration Tests:

- Phase 1: migrated sequential-idempotency happy-path + no-duplicate-send (existing, unchanged assertions, new runtime)
- Phase 2: 3-failure → terminal state → exclusion from future runs
- Phase 3: single HTTP-error → caught, recorded, batch continues

### Manual Testing Steps:

1. Run `npm run test:ci` locally and confirm all suites (node-based unit tests + Workers-pool breach-job integration tests) pass together
2. Spot-check that the Workers pool is actually engaged (not silently degrading to `node`) by temporarily asserting on a Workers-only global, then removing that assertion once confirmed
3. Read through the new tests' mocked-error shapes against the real `email-client.ts` error-construction code to confirm they test real shapes, not assumptions

## Performance Considerations

The Workers pool spins up isolated `workerd` instances per test file — expect the breach-job suite to run measurably slower than it did under plain `node`. This is an accepted cost of runtime parity; no optimization work is in scope. If CI runtime becomes a concern later, scoping the pool to only the files that need it (as this plan does) is already the mitigation.

## Migration Notes

No data migrations. The only "migration" here is moving an existing test file's execution environment from `node` to `@cloudflare/vitest-pool-workers` — Phase 1's success criteria explicitly require the existing assertions to remain unchanged, so this is a pure environment swap, not a behavioral change to the test or the system under test.

## References

- Related research: `context/changes/test-infra-breach-to-email/research.md`
- Existing integration test to migrate and extend: [`src/lib/services/__tests__/breach-notifications-idempotency.test.ts`](src/lib/services/__tests__/breach-notifications-idempotency.test.ts:1)
- Job logic under test: [`src/lib/services/breach-notifications.ts:121-232`](src/lib/services/breach-notifications.ts:121)
- Email client (raw-fetch Resend call, deliberately `workerd`-friendly): [`src/lib/services/email-client.ts:5-29`](src/lib/services/email-client.ts:5)
- Vitest config + `astro:env/server` shim to reconcile: [`vitest.config.ts:1-54`](vitest.config.ts:1)
- Env-loading setup (anticipates a worker-pool model in its own comment): [`vitest.setup.ts:1-29`](vitest.setup.ts:1)
- Deployed runtime parity target: [`wrangler.jsonc:5-6`](wrangler.jsonc:5)
- Prior architectural decisions on idempotency/retry: `context/changes/email-alarm-on-limit-breach/plan.md`, `context/changes/email-alarm-on-limit-breach/research.md`
- Prior Vitest-bootstrap decisions being built upon: `context/changes/window-boundary-idempotency/plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Add Workers pool and migrate the breach-job suite

#### Automated

- [x] 1.1 Dependency installs cleanly: `npm install`
- [x] 1.2 Type checking passes: `npm run typecheck`
- [x] 1.3 Linting passes: `npm run lint`
- [x] 1.4 Migrated breach-job suite passes under the Workers pool: `npm run test:ci -- breach-notifications-idempotency`
- [x] 1.5 Both pre-existing tests pass with original assertions intact

#### Manual

- [x] 1.6 Full suite run confirms pure-unit suites still run under `node` and pass
- [x] 1.7 Confirm breach-job suite actually executes inside `workerd` (not silently falling back to `node`)

### Phase 2: Retry / terminal-failure path coverage

#### Automated

- [ ] 2.1 New test passes: `npm run test:ci -- breach-notifications`
- [ ] 2.2 Type checking passes: `npm run typecheck`
- [ ] 2.3 Linting passes: `npm run lint`
- [ ] 2.4 Existing two idempotency tests remain green

#### Manual

- [ ] 2.5 Review test assertions against `markBreachNotified`/attempt-recording logic for precision

### Phase 3: Resend HTTP-error path coverage

#### Automated

- [ ] 3.1 New test passes: `npm run test:ci -- breach-notifications`
- [ ] 3.2 Type checking passes: `npm run typecheck`
- [ ] 3.3 Linting passes: `npm run lint`
- [ ] 3.4 All prior tests in the suite remain green

#### Manual

- [ ] 3.5 Confirm mocked error shape mirrors real `email-client.ts:24-28` output
- [ ] 3.6 Full suite (`npm run test:ci`) runs cleanly end to end (node + Workers pool)
