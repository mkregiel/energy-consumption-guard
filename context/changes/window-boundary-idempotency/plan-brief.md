# Window boundary + idempotency tests — Plan Brief

> Full plan: `context/changes/window-boundary-idempotency/plan.md`
> Research: `context/changes/window-boundary-idempotency/research.md`

## What & Why

Phase 2 of the test rollout (see `context/foundation/test-plan.md §3`). Protects against two risks: **R4** — a wrong calendar window boundary causing the consumption sum to cover the wrong period (breach never fires, or fires on every evaluation); and **R2** — a second dispatch-job run for the same breach sending a duplicate email to the user.

## Starting Point

No test runner exists: no `vitest.config.ts`, no `.test.ts` files, no `vitest` in `devDependencies`. Both services under test (`consumption-window.ts`, `breach-notifications.ts`) already accept dependencies as parameters, making them testable without framework-level mocking. The one non-obvious constraint is `email-client.ts`, which imports from Astro's virtual module `astro:env/server` — this must be shimmed in the Vitest config.

## Desired End State

`npm test` runs and passes a suite of unit and integration tests. Anyone reading `context/foundation/test-plan.md §6.1` and `§6.3` can follow the established patterns to add a new test without looking at the test files. Phase 2 of the rollout table shows `shipped`.

## Key Decisions Made

| Decision                   | Choice                                     | Why (1 sentence)                                                                                                 | Source               |
| -------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | -------------------- |
| Bootstrap in this plan     | Yes — Phase 1 here installs Vitest         | Phase 1 of the rollout hasn't shipped; blocking on it would stall Phase 2                                        | Plan                 |
| R4 test layer              | Unit test `getWindowBounds()` directly     | The function is pure, accepts explicit `referenceDate`, and is the single source of truth for boundary values    | Research             |
| Preview predicate coverage | One stub-based operator test               | Cheap, no DB needed; catches `.gt` / `.lte` divergence that a `getWindowBounds()` test won't                     | Plan                 |
| R2 DB layer                | Real Supabase (local via `supabase start`) | The anti-pattern is testing idempotency only at DB insert level; a stub would lie about the `notified_at` update | Research / Test-plan |
| Concurrent-run race        | Document as known gap (inline comment)     | Sequential tests can't cover it; acceptable at MVP cron cadence (single-instance, 10-minute interval)            | Research             |

## Scope

**In scope:**

- Vitest setup with `astro:env/server` shim and `@/` path alias
- Unit tests: `getWindowBounds()` for all window types, boundary inclusivity, DST spring-forward
- Unit test: `getLimitWindowPreview` predicate operator verification
- Integration test: `runBreachNotifications()` double-run idempotency
- Test-plan cookbook update (§6.1, §6.3) and Phase 2 status sync

**Out of scope:**

- End-to-end boundary test via `limit-evaluation.ts` with real DB readings
- Fix for the concurrent dispatch race condition
- Any changes to production code
- CI/CD pipeline wiring (Phase 4 of the rollout)

## Architecture / Approach

Services take injected clients → standard Vitest (no `@cloudflare/vitest-pool-workers` needed). Unit tests are pure TS with explicit time fixtures. The integration test uses a service-role Supabase client with a test user created/destroyed in `beforeAll` / `afterAll`; cascading deletes handle row cleanup. `email-client.ts` is replaced entirely via `vi.mock` so the Resend HTTP call is never made.

## Phases at a Glance

| Phase                  | What it delivers                                                 | Key risk                                                                     |
| ---------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1. Bootstrap           | Vitest installed, `astro:env/server` shimmed, `npm test` exits 0 | Astro virtual module resolution in Vitest environment                        |
| 2. R4 unit tests       | Window boundary fixtures pass; predicate operator test passes    | DST fixture values computed incorrectly from code (mirror-test anti-pattern) |
| 3. R2 integration test | Double-run idempotency proven with real Supabase                 | Local Supabase not running; `.env.test` not populated                        |
| 4. Cookbook + sync     | §6.1 / §6.3 filled; Phase 2 status = shipped                     | —                                                                            |

**Prerequisites:** Node 18+ (full ICU for `Intl.DateTimeFormat`); `supabase start` for Phase 3; `.env.test` populated with local credentials before Phase 3.

**Estimated effort:** ~1–2 sessions across 4 phases.

## Open Risks & Assumptions

- The `astro:env/server` shim exports only the four env var names currently used in `email-client.ts`. If other files import additional names from that virtual module, the shim will need extension.
- The `week` window fixture assumes Monday as the ISO week start — confirmed in `consumption-window.ts:108–110` (`WEEKDAY_INDEX` + `(dayIndex + 6) % 7`).
- The integration test creates an `auth.users` row in the local Supabase. If the local instance has email-confirmation required, `createUser` may behave differently — use the `email_confirm: true` option to bypass.

## Success Criteria (Summary)

- `npm test` exits 0 with unit and integration tests all passing.
- Manually mutating `.gte` → `.gt` in `limit-consumption-preview.ts:27` causes the predicate test to fail.
- Running `runBreachNotifications()` twice in the integration test results in `sendPlainTextEmail` being called exactly once.
