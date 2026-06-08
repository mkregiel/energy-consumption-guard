# Test Infra (Workers Pool) + Breach-to-Email Risk Coverage — Plan Brief

> Full plan: `context/changes/test-infra-breach-to-email/plan.md`
> Research: `context/changes/test-infra-breach-to-email/research.md`

## What & Why

`test-plan.md` Phase 1 calls for "bootstrap Vitest + Cloudflare Workers test env; prove breach event → email dispatch is correct and called exactly once per breach" (risks R1/R2/R5). Research found that `window-boundary-idempotency` already shipped almost all of this — Vitest is bootstrapped and a real integration test already proves the "exactly once" guarantee. This plan closes what's _actually_ still missing: Workers-runtime parity for the test suite, and coverage for the retry/terminal-failure and Resend-HTTP-error paths — the two risk-bearing behaviors that remain genuinely untested.

## Starting Point

Vitest is fully bootstrapped (`vitest.config.ts`, `astro:env/server` shim, `.env.test` convention, npm scripts). [`breach-notifications-idempotency.test.ts`](src/lib/services/__tests__/breach-notifications-idempotency.test.ts:1) already runs the breach-dispatch job against a real local Supabase instance with the email client mocked, proving sequential idempotency. It runs in plain `node` — not the Cloudflare Workers runtime the job deploys to — and doesn't cover what happens when sends keep failing or fail with an HTTP error.

## Desired End State

The breach-job test suite runs inside a Workers-compatible runtime (`@cloudflare/vitest-pool-workers`, configured to match `wrangler.jsonc`'s `compatibility_date`/`compatibility_flags`), the existing two tests still pass unchanged, and two new integration tests prove: (1) after 3 failed sends, the breach is marked terminal (`notification_failed_at` set, `notification_attempt_count` = 3) and excluded from future runs, and (2) a Resend HTTP error is caught, recorded, and doesn't crash the batch.

## Key Decisions Made

| Decision                     | Choice                                                                       | Why (1 sentence)                                                                                                                                            | Source             |
| ---------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Phase 1 direction            | Re-scope to real gaps, don't re-bootstrap                                    | Existing `window-boundary-idempotency` already shipped the bootstrap + the "exactly once" proof; redoing it would waste effort                              | Research           |
| Cloudflare Workers test pool | Add `@cloudflare/vitest-pool-workers` for runtime parity                     | `test-plan.md` explicitly calls for a Workers test env; the deployed job runs in `workerd`, not `node`                                                      | Plan (user choice) |
| Suite migration scope        | Migrate the breach-job suite onto the pool; leave pure-unit suites on `node` | True runtime parity for the job that actually deploys to Workers; pure-function tests have no runtime dependency to migrate                                 | Plan (user choice) |
| Concurrent-race gap          | Leave it as an accepted MVP limitation — out of scope                        | Two prior plans already made this call deliberately (single-instance, hourly cadence); revisiting it here would be scope creep                              | Plan (user choice) |
| Retry/terminal-failure tests | Integration test, same real-DB + mocked-email pattern as existing suite      | Reuses proven fixtures and conventions — lowest risk, and proves the actual DB-write behavior, not just decision logic                                      | Plan (user choice) |
| Resend HTTP-error tests      | Mock `email-client` to reject, assert the job's catch/record path            | Consistent with the established "mock at the email-client boundary" convention; tests the risk-bearing job behavior, not the narrower HTTP-translation unit | Plan (user choice) |
| Cut line if time is short    | Workers-pool setup is must-have; new test cases can trail                    | Secures the infra milestone `test-plan.md` calls out explicitly first                                                                                       | Plan (user choice) |

## Scope

**In scope:**

- Installing and configuring `@cloudflare/vitest-pool-workers` for the breach-job suite
- Migrating `breach-notifications-idempotency.test.ts` onto the new pool (assertions unchanged)
- Reconciling the `astro:env/server` shim and `.env.test` env delivery with the Workers pool's runtime model
- New integration test: retry → terminal-failure (3 attempts → `notification_failed_at`)
- New integration test: Resend HTTP-error → caught and recorded, batch continues

**Out of scope:**

- Re-bootstrapping Vitest, npm scripts, or the env shim (already shipped)
- New happy-path/sequential-idempotency tests (already covered)
- Concurrent-race gap testing or fixing (accepted MVP limitation)
- Unit-testing `email-client.ts`'s own HTTP-to-throw translation (mocking global `fetch`)
- Migrating the pure-unit suites (`consumption-window`, `consumption-preview-predicate`) to the Workers pool

## Architecture / Approach

The breach-job integration suite gets its own Vitest project/config scoped to `@cloudflare/vitest-pool-workers`, with `compatibility_date`/`compatibility_flags` mirroring `wrangler.jsonc`. Pure-unit suites stay on `node`. New tests reuse the existing hoisted `vi.mock('@/lib/services/email-client', ...)` + real-local-Supabase pattern, varying only the mock's resolved/rejected behavior to simulate failure scenarios — no new mocking infrastructure, no new fixtures beyond what the existing `beforeEach` chain provides.

## Phases at a Glance

| Phase                              | What it delivers                                                                  | Key risk                                                                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1. Workers pool migration          | Suite runs under `@cloudflare/vitest-pool-workers`, existing tests pass unchanged | Reconciling `astro:env/server` shim + `.env.test` delivery with the pool's runtime model — could silently break env resolution |
| 2. Retry/terminal-failure coverage | New test proving 3-failure → terminal state → exclusion                           | Asserting the terminal condition precisely as production code implements it (not as assumed)                                   |
| 3. Resend HTTP-error coverage      | New test proving caught/recorded/non-crashing batch                               | Mocked error shape must mirror the real `email-client.ts` error construction, not an imagined one                              |

**Prerequisites:** None beyond what's already shipped — Vitest, the existing integration test, and the established mocking conventions are all in place.
**Estimated effort:** ~1-2 sessions across 3 phases (Phase 1 is the heavier lift; Phases 2-3 are each a single new test reusing an established pattern).

## Open Risks & Assumptions

- The exact mechanism `@cloudflare/vitest-pool-workers` uses to deliver environment values to a worker (vs. Node's `process.env`) is not yet confirmed — Phase 1 explicitly flags this as the one piece that must be resolved empirically, not pre-decided.
- Migrating a currently-green suite to a new runtime carries inherent risk of breaking it; Phase 1's success criteria require the existing assertions to remain byte-for-byte unchanged specifically to keep this risk visible and bounded.

## Success Criteria (Summary)

- `npm run test:ci` runs the full suite (pure-unit on `node`, breach-job on Workers pool) green, end to end
- The two pre-existing idempotency tests pass with unchanged assertions, now under `workerd`
- Two new tests demonstrably fail if the retry/terminal-failure or HTTP-error handling logic regresses (verified by reading their assertions against the real production code, not by inspection of green output alone)
