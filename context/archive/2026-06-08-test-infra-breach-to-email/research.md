---
date: 2026-06-08T18:44:52Z
researcher: Claude
git_commit: 47a276741fff7ac5041866971a767a8778b2b1be
branch: claude/eager-saha-39d714
repository: energy-consumption-guard
topic: "Breach-notification job + test infrastructure for Phase 1 (test-infra-breach-to-email)"
tags: [research, codebase, breach-notifications, vitest, test-infra, idempotency]
status: complete
last_updated: 2026-06-08
last_updated_by: Claude
---

# Research: Breach-notification job + test infrastructure for Phase 1

**Date**: 2026-06-08T18:44:52Z
**Researcher**: Claude
**Git Commit**: 47a276741fff7ac5041866971a767a8778b2b1be
**Branch**: claude/eager-saha-39d714
**Repository**: energy-consumption-guard

## Research Question

For the `test-infra-breach-to-email` change (test-plan.md Phase 1: "Bootstrap Vitest + Cloudflare Workers test env; prove breach event → email dispatch is correct and called exactly once per breach", covering risks R1/R2/R5): how does the breach-notification job work end-to-end (entry point, `limit_breach_events` query, Resend call), and what test infrastructure already exists to build on?

## Summary

**The work this phase describes appears to already be done.** A prior change, `window-boundary-idempotency` (status: done, last touched in the most recent commits on this branch), already:

1. Bootstrapped Vitest (`vitest.config.ts`, `.env.test` convention, `astro:env/server` shim, npm scripts).
2. Wrote unit tests for window-boundary logic (`consumption-window.test.ts`, `consumption-preview-predicate.test.ts`).
3. Wrote a real integration test, [`breach-notifications-idempotency.test.ts`](src/lib/services/__tests__/breach-notifications-idempotency.test.ts), that runs `runBreachNotifications()` against a **local live Supabase instance** with the email client mocked via `vi.mock()`, and asserts the email is sent **exactly once** across two sequential dispatcher runs — i.e., it already proves "breach event → email dispatch is correct and called exactly once per breach" for the sequential case.

What is **not** present: `@cloudflare/vitest-pool-workers` (no Cloudflare Workers pool — tests run in plain `node` environment), and no test for the concurrent-race gap (acknowledged as an accepted MVP limitation in both the test comments and the original plan).

This means Phase 1, as scoped in `test-plan.md`, is either **already substantially satisfied** by `window-boundary-idempotency`, or the phase needs to be **re-scoped** around the remaining gaps (Cloudflare Workers pool, concurrent-race coverage, retry/terminal-failure paths, Resend HTTP error handling) rather than "bootstrapping from zero." Worth surfacing to the user before writing a plan — re-doing already-shipped infra would be wasted effort.

## Detailed Findings

### Breach-notification job flow

- **Entry point**: `src/pages/api/cron/send-notifications.ts:16-38` — a `POST`-only API route, triggered hourly at `:10` by Cloudflare Workers cron (`wrangler.jsonc:16`, schedule `"10 * * * *"`), authenticated via `assertCronAuthorized()` ([cron-auth.ts:16](src/lib/services/cron-auth.ts:16)) using a timing-safe `CRON_SECRET` comparison.
- **Two-job pipeline** (per `email-alarm-on-limit-breach/plan.md`): `:05` job `evaluate-limits` inserts `limit_breach_events` rows when consumption crosses threshold; `:10` job `send-notifications` dispatches emails for unnotified breaches.
- **Query/idempotency** — [breach-notifications.ts:130-135](src/lib/services/breach-notifications.ts:130):
  ```ts
  supabase
    .from("limit_breach_events")
    .select("*, consumption_limits(threshold_kwh, window_type, timezone)")
    .is("notified_at", null)
    .is("notification_failed_at", null)
    .order("breached_at", { ascending: true });
  ```
  Three-layer idempotency: (1) DB partial unique index on `(limit_id, window_start)`, (2) dispatch query filters to `notified_at IS NULL AND notification_failed_at IS NULL`, (3) `markBreachNotified()` ([breach-notifications.ts:86-119](src/lib/services/breach-notifications.ts:86)) does a conditional `.is("notified_at", null)` update with 3-attempt retry/backoff. A **concurrent-race gap** is explicitly accepted (two dispatchers racing the same row could both send) — documented in code comments and the original plan as an MVP-acceptable limitation at single-instance, hourly cadence.
- **Email dispatch**: loop over breaches → load `notification_settings.alarm_email` → build plain-text email via `buildBreachAlarmEmail()` ([breach-email-content.ts:18](src/lib/services/breach-email-content.ts:18)) → `sendPlainTextEmail()` ([email-client.ts:5-29](src/lib/services/email-client.ts:5)), a raw `fetch` to `https://api.resend.com/emails` (no SDK, to avoid `workerd` friction). Non-2xx responses throw; failures increment `notification_attempt_count` and set `notification_failed_at` after 3 attempts (terminal).

### Existing test infrastructure (already bootstrapped)

- **`vitest.config.ts`** ([vitest.config.ts:1-54](vitest.config.ts:1)): Node test environment, `@/ → src/` alias, a virtual-module shim re-exporting `astro:env/server` values from `process.env`, `.env.test` convention (`.env.test.example` committed as template), include pattern `src/**/*.test.ts`.
- **npm scripts** (package.json:6-8): `test` → `vitest run --passWithNoTests`, `test:ci` → `vitest run`, `test:watch` → `vitest`.
- **Three existing test files** in `src/lib/services/__tests__/`:
  - `consumption-window.test.ts` — pure-function unit tests with `it.each()` fixture tables, calendar-oracle expected values, DST edge cases.
  - `consumption-preview-predicate.test.ts` — unit test using a hand-rolled recording mock to assert exact Supabase query-builder filter calls (`.gte`/`.lt`).
  - **`breach-notifications-idempotency.test.ts`** ([full file](src/lib/services/__tests__/breach-notifications-idempotency.test.ts:1-152)) — integration test against a **real local Supabase** instance (service-role client, bypasses RLS), with `email-client` module-mocked via hoisted `vi.mock()`. Two tests: "sends email on first run" and "does not send email on second run for same breach" (sequential idempotency). `beforeAll`/`afterAll` create/delete a real auth user (cascades fixture rows); `beforeEach` inserts `consumption_limits` → `limit_breach_events` → `notification_settings`.
- **Mocking conventions established**: external services (Resend) mocked via hoisted `vi.mock('@/lib/services/email-client', ...)`; Supabase is **not** mocked in integration tests — a real local instance is used with the service-role key.
- **Gaps confirmed absent**: `@cloudflare/vitest-pool-workers` is not installed/configured anywhere (tests run in plain `node`, not a Workers runtime); no test covers the concurrent-race scenario, the 3-attempt terminal-failure path, missing-settings error paths, or Resend HTTP error/retry handling; Tuya integration has no tests at all.

## Code References

- `src/pages/api/cron/send-notifications.ts:16-38` - cron entry point, auth, service invocation
- `src/lib/services/breach-notifications.ts:121-232` - `runBreachNotifications`, query, idempotency loop
- `src/lib/services/breach-notifications.ts:86-119` - `markBreachNotified`, conditional update + retry
- `src/lib/services/email-client.ts:5-29` - `sendPlainTextEmail`, raw Resend `fetch`, error handling
- `src/lib/services/breach-email-content.ts:18-46` - email template (`buildBreachAlarmEmail`)
- `src/lib/services/limit-evaluation.ts:142` - where breach rows are inserted (upstream `:05` job)
- `wrangler.jsonc:16` - cron schedule `"10 * * * *"`
- `vitest.config.ts:1-54` - Vitest config, `astro:env/server` shim, env conventions
- `src/lib/services/__tests__/breach-notifications-idempotency.test.ts:1-152` - existing integration test (sequential idempotency, mocked email)
- `src/lib/services/__tests__/consumption-window.test.ts:1-83` - window-boundary unit tests
- `src/lib/services/__tests__/consumption-preview-predicate.test.ts:1-60` - query-predicate unit test pattern
- `package.json:6-8` - test scripts; `package.json:47,51-53,72` - relevant devDependencies

## Architecture Insights

- **Idempotency is layered, not single-mechanism**: DB unique index + query filter + conditional update + retry cap, each closing a different race window. Any new test work should target the _specific_ layer it's proving, not re-prove the whole stack.
- **Resend is called via raw `fetch`, not the SDK** — a deliberate choice to avoid `workerd` (Cloudflare Workers runtime) compatibility friction. This shapes how tests must mock it (module-level `vi.mock`, not HTTP-level interception of an SDK).
- **Test doubles follow a "mock the boundary, keep the DB real" convention**: external paid/non-deterministic services (Resend) are mocked; Supabase is exercised against a real local instance with the service-role key (bypasses RLS) — this is the established pattern future integration tests should follow.
- **The `astro:env/server` virtual module is a recurring friction point** that required a custom shim in `vitest.config.ts` — this is the root cause of several "pre-existing TS errors" noted elsewhere; any new test infra work doesn't need to re-solve it, just reuse the shim.

## Historical Context (from prior changes)

- [`context/changes/email-alarm-on-limit-breach/plan.md`](context/changes/email-alarm-on-limit-breach/plan.md) - original design: two-job cron pipeline, three-layer idempotency, plain-text Resend dispatch via raw `fetch`, retry/terminal-failure policy, `scripts/seed-test-breach.ts` seed/cleanup helper.
- [`context/changes/email-alarm-on-limit-breach/research.md:30-31`](context/changes/email-alarm-on-limit-breach/research.md) - idempotency layering rationale, including the accepted concurrent-race gap.
- [`context/changes/window-boundary-idempotency/plan.md`](context/changes/window-boundary-idempotency/plan.md) - **the change that actually bootstrapped Vitest** (Phases 1-2: config, shim, npm scripts, unit tests) **and wrote the breach-notification integration test** (Phase 3: `breach-notifications-idempotency.test.ts`, real-local-Supabase + mocked-email pattern). Status: done (most recent commits on this branch are its impl-review fixes).
- [`context/changes/window-boundary-idempotency/research.md`](context/changes/window-boundary-idempotency/research.md) - grounding for the Vitest bootstrap and mocking-strategy decisions reused above.
- [`context/changes/transactional-email-alerts/plan.md`](context/changes/transactional-email-alerts/plan.md) - related email-dispatch implementation context (referenced by the agent, not deeply explored here — candidate for follow-up if email-template/dispatch changes are in scope).

## Related Research

- `context/changes/window-boundary-idempotency/research.md` - prior research grounding the Vitest bootstrap (directly overlaps with this phase's stated goal).
- `context/changes/email-alarm-on-limit-breach/research.md` - prior research grounding the breach-notification job design.

## Open Questions

1. **Is Phase 1 already done?** `window-boundary-idempotency` shipped a Vitest bootstrap and a breach-dispatch integration test that together cover most of what Phase 1 describes ("bootstrap Vitest... prove breach event → email dispatch is correct and called exactly once per breach"). Worth confirming with the user whether `test-plan.md` Phase 1 should be marked done/superseded, or re-scoped to the genuine remaining gaps below — before writing a plan that risks duplicating shipped work.
2. **What's the real remaining scope, if any?** Candidates: (a) `@cloudflare/vitest-pool-workers` integration (running tests in an actual Workers runtime rather than `node`) — note R5 in the test-plan calls for "integration (job logic, stub at Resend ACK boundary)", which the existing test already does without a Workers pool; (b) concurrent-race coverage (explicitly accepted as out-of-scope at MVP in two prior plans — re-litigating this would be a scope change, not a gap-fill); (c) retry/terminal-failure path tests (3rd-attempt → `notification_failed_at`); (d) Resend HTTP error/non-2xx handling tests.
3. Should the `@cloudflare/vitest-pool-workers` requirement in `test-plan.md` §4 (if any — re-check after the §4 edit made earlier this session) be reconciled with the fact that the shipped integration test runs fine in plain `node` without it?
