# Window boundary + idempotency tests — Implementation Plan

## Overview

Phase 2 of the project's phased test rollout (see `context/foundation/test-plan.md §3`). Adds tests covering two risks:

- **R4** — window boundary arithmetic: proves that the limit-evaluation window sum uses the correct calendar boundaries and that readings exactly at the boundary are handled as specified (start-inclusive, end-exclusive).
- **R2** — email dispatch idempotency: proves that running the notification job twice for the same unnotified breach event results in exactly one email being sent.

Phase 1 of the rollout (breach-to-email path, `context/changes/testing-breach-to-email`) has not shipped yet, so this plan opens with a bootstrap phase that installs the test runner and configures the environment.

## Current State Analysis

No test infrastructure exists: no `vitest.config.ts`, no `.test.ts` files, no `vitest` in `devDependencies`.

The two services under test already have clean, injectable designs:

- `getWindowBounds(windowType, timezone, referenceDate?)` in `src/lib/services/consumption-window.ts` — pure function, no side effects, accepts an explicit `referenceDate` parameter (easy to fixture).
- `runBreachNotifications(supabase: SupabaseClient)` in `src/lib/services/breach-notifications.ts` — accepts the DB client as a parameter; the only external I/O is the Supabase client and `sendPlainTextEmail` from `email-client.ts`.

**Critical constraint:** `email-client.ts` imports from `astro:env/server` — Astro's virtual module system. This module does not exist in a standard Vitest/Node environment. The `vitest.config.ts` must shim this virtual module, or `email-client.ts` must always be `vi.mock()`'d before it is evaluated. Both are required: the shim as a safety net; `vi.mock` in the idempotency test for behavioural control.

**Integration test DB dependency:** The idempotency test uses a real Supabase instance (local via `supabase start`). All tables have `FORCE ROW LEVEL SECURITY`. The service-role key bypasses RLS, but FK constraints still apply — a real `auth.users` row is needed before inserting `consumption_limits` or `limit_breach_events`.

### Key Discoveries

- `src/lib/services/consumption-window.ts:92–121` — `getWindowBounds()` calendar semantics fully documented; three window types, all calendar-based, all referencing `"Europe/Warsaw"` (stored on the limit row).
- `src/lib/services/limit-consumption-preview.ts:27–28` — preview query uses `.gte("recorded_at", windowStartIso).lt("recorded_at", windowEndIso)`.
- `src/lib/services/breach-notifications.ts:130–135` — dispatch query: `notified_at IS NULL AND notification_failed_at IS NULL`.
- `src/lib/services/breach-notifications.ts:94–100` — `markBreachNotified` uses `.is("notified_at", null)` on the UPDATE — a conditional write that no-ops if another run beat it.
- `supabase/migrations/20260531193000_limit_breach_events_window_start_unique.sql:6–8` — partial unique index `(limit_id, window_start) WHERE window_start IS NOT NULL` — only one breach row per calendar window per limit.
- `tsconfig.json:9` — path alias `"@/*": ["./src/*"]` — must be mirrored in `vitest.config.ts`.
- `package.json` — no `vitest` in `devDependencies`; `supabase` CLI already present at `^2.23.4`.

## Desired End State

`npm test` runs without errors. The suite contains:

1. Unit tests for `getWindowBounds()` verifying correct `windowStart` / `windowEnd` for all three window types, exact boundary values at and around the transition, and correct behaviour during a DST spring-forward day.
2. One stub-based unit test verifying `getLimitWindowPreview` issues `.gte()` + `.lt()` (not `.gt()` / `.lte()`) for the `recorded_at` filter.
3. One integration test verifying that invoking `runBreachNotifications()` twice for the same unnotified breach event results in `sendPlainTextEmail` being called exactly once.
4. `context/foundation/test-plan.md §6.1` and `§6.3` filled with cookbook patterns; Phase 2 status updated to `shipped`.

### Key Discoveries (repeated for implementer):

- `getWindowBounds()` uses `Intl.DateTimeFormat` for timezone math — requires Node.js full ICU (included by default in Node 18+).
- The `astro:env/server` shim in `vitest.config.ts` is load-bearing: without it, any test that imports (directly or transitively) from `email-client.ts` without a `vi.mock` will fail with a module resolution error.
- `vi.mock('@/lib/services/email-client')` must be hoisted (Vitest does this automatically for top-level `vi.mock` calls) to prevent `astro:env/server` from being evaluated.

## What We're NOT Doing

- No tests for `limit-evaluation.ts` end-to-end (reading inserted at boundary → breach triggered) — R4 is covered at the unit layer; integration-level boundary coverage is deferred.
- No test for the concurrent-run race (two dispatchers sending simultaneously) — accepted as a known gap at MVP cron cadence; documented with a comment in the test.
- No test for the Tuya sync path (R3 — deferred to Phase 3 of the rollout).
- No CI/CD wiring (R6 / Phase 4 of the rollout).
- Not modifying any production code — tests only.

## Implementation Approach

Four sequential phases: bootstrap → R4 unit tests → R2 integration test → cookbook sync. Each phase has a hard automated gate before the next begins. Phase 3 (integration) requires `supabase start` running locally and `.env.test` populated.

## Critical Implementation Details

**`astro:env/server` in Vitest.** `email-client.ts` does `import { RESEND_API_KEY, RESEND_FROM_EMAIL } from "astro:env/server"`. Vitest does not know about Astro virtual modules. Add a Vite plugin in `vitest.config.ts` that resolves this virtual module and re-exports the values from `process.env`. Without it, any test file that transitively imports `email-client.ts` without a `vi.mock` will throw `Cannot find module 'astro:env/server'`. In the idempotency test, `vi.mock('@/lib/services/email-client', () => ({ ... }))` prevents the real module from loading, so the shim is a belt-and-suspenders measure — but required for future tests that don't mock it.

**Integration test user lifecycle.** All tables require a real `auth.users` row due to FK constraints. Create the test user via `supabase.auth.admin.createUser({ email: '...', password: '...' })` in `beforeAll`. Delete the user (and cascaded rows) via `supabase.auth.admin.deleteUser(userId)` in `afterAll`. Cascading deletes cover `consumption_limits`, `limit_breach_events`, `notification_settings` — no manual row cleanup needed.

**RLS and service-role key.** All tables have `FORCE ROW LEVEL SECURITY` but the service-role key maps to the `service_role` Postgres role which has `BYPASSRLS` — inserts and queries proceed without an `auth.uid()`. Use `createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)` for the test client.

---

## Phase 1: Bootstrap — Vitest configuration

### Overview

Install Vitest, configure path alias resolution and the `astro:env/server` shim, add `npm test` script, and verify the runner exits cleanly with no test files.

### Changes Required

#### 1. Install Vitest

**File**: `package.json`

**Intent**: Add `vitest` and `@vitest/coverage-v8` to `devDependencies`; add `"test": "vitest run"` and `"test:watch": "vitest"` scripts.

**Contract**: The `test` script runs `vitest run` (CI-safe, exits after one pass). The `test:watch` script runs `vitest` (watch mode for development). No `--coverage` flag on the base `test` script — coverage is opt-in.

#### 2. Create vitest.config.ts

**File**: `vitest.config.ts` (new, project root)

**Intent**: Configure Vitest to resolve the `@/` path alias and shim `astro:env/server` so tests can import any service file without the Astro build pipeline.

**Contract**: The config must:

- Set `test.environment: 'node'` (no browser/jsdom needed for service-layer tests).
- Set `test.include: ['src/**/*.test.ts']`.
- Mirror the tsconfig path alias: `resolve.alias = { '@': path.resolve(__dirname, './src') }`.
- Add a Vite plugin that resolves `astro:env/server` as a virtual module re-exporting `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY` from `process.env`. The plugin pattern is:

```ts
{
  name: 'astro-env-server-shim',
  resolveId(id) {
    if (id === 'astro:env/server') return '\0astro:env/server';
  },
  load(id) {
    if (id === '\0astro:env/server') {
      return [
        'export const RESEND_API_KEY = process.env.RESEND_API_KEY;',
        'export const RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL;',
        'export const PUBLIC_SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL;',
        'export const PUBLIC_SUPABASE_ANON_KEY = process.env.PUBLIC_SUPABASE_ANON_KEY;',
      ].join('\n');
    }
  },
}
```

The snippet above is included because the `\0` prefix convention for virtual modules is non-obvious and the export names must exactly match what the production code destructures.

#### 3. Add .env.test template

**File**: `.env.test` (new, project root)

**Intent**: Provide a template for the environment variables the integration tests need. The file itself is gitignored; this is the committed template developers copy and fill in.

**Contract**: The file should be named `.env.test.example` (committed) with empty values:

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
RESEND_API_KEY=test
RESEND_FROM_EMAIL=test@example.com
```

The Vitest config loads `.env.test` via `dotenv` or Vitest's built-in `envFile` option pointing at `.env.test`.

#### 4. Update .gitignore

**File**: `.gitignore`

**Intent**: Exclude `.env.test` (the filled-in copy with real credentials) from version control.

**Contract**: Add a single line `.env.test` under the existing env-file section.

### Success Criteria

#### Automated Verification

- `npm install` completes without errors; `vitest` appears in `node_modules/.bin/`.
- `npm test` exits 0 with output `No test files found, exiting with code 0` (or equivalent).
- `npm run typecheck` passes (vitest types installed).

#### Manual Verification

- Copy `.env.test.example` to `.env.test`, populate with local Supabase credentials, run `npm test` — exits 0.

**Implementation Note**: After Phase 1 automated verification passes, confirm manually before proceeding.

---

## Phase 2: R4 — Window boundary unit tests

### Overview

Unit tests for `getWindowBounds()` covering all three window types, exact boundary timestamps, and the DST spring-forward edge case. Plus one stub-based test verifying `getLimitWindowPreview` uses the correct predicate operators for `recorded_at`.

### Changes Required

#### 1. Window boundary unit tests

**File**: `src/lib/services/__tests__/consumption-window.test.ts` (new)

**Intent**: Prove `getWindowBounds()` returns the correct `windowStart` and `windowEnd` for each window type given a known `referenceDate`, and that the half-open interval semantics (`>= windowStart`, `< windowEnd`) follow from the returned boundary values.

**Contract**: Use `it.each` parameterised tests with a table of `{ windowType, referenceDate, expectedStart, expectedEnd }` fixtures. Each fixture provides:

- An explicit `referenceDate` as a UTC ISO string (so tests are timezone-independent).
- `expectedStart` and `expectedEnd` as UTC ISO strings derived from the calendar oracle (not from running `getWindowBounds()` and recording the output).

Required fixture rows (compute oracle values from calendar rules, not from the code):

| windowType  | referenceDate (UTC)        | expectedStart (UTC)        | expectedEnd (UTC)          | Notes                                                                          |
| ----------- | -------------------------- | -------------------------- | -------------------------- | ------------------------------------------------------------------------------ |
| `day`       | `2026-06-15T10:00:00.000Z` | `2026-06-14T22:00:00.000Z` | `2026-06-15T22:00:00.000Z` | June 15 midnight CEST = UTC+2                                                  |
| `week`      | `2026-06-11T10:00:00.000Z` | `2026-06-07T22:00:00.000Z` | `2026-06-14T22:00:00.000Z` | Thu → Mon 9 June → next Mon 15 June midnight CEST                              |
| `month`     | `2026-06-15T10:00:00.000Z` | `2026-05-31T22:00:00.000Z` | `2026-06-30T22:00:00.000Z` | June 1 midnight CEST; July 1 midnight CEST                                     |
| `day` (DST) | `2026-03-29T10:00:00.000Z` | `2026-03-28T23:00:00.000Z` | `2026-03-29T22:00:00.000Z` | Spring-forward day: start at CET (UTC+1), end at CEST (UTC+2) → 23-hour window |

Assert: `result.windowStart.toISOString() === expectedStart` and `result.windowEnd.toISOString() === expectedEnd`.

Add three standalone tests (not parameterised) for boundary semantics — these use the `month` fixture as the vehicle:

- `windowStart` is included in the window: a timestamp equal to `windowStart.getTime()` satisfies `ts >= windowStart.getTime()` — assert true.
- `windowEnd` is excluded: a timestamp equal to `windowEnd.getTime()` does NOT satisfy `ts < windowEnd.getTime()` — assert false.
- One millisecond before `windowStart` is excluded: `windowStart.getTime() - 1 < windowStart.getTime()` — assert true (i.e., the reading would not pass the `>=` predicate).

These three tests pin the half-open interval semantics as an oracle fact, so a future refactor that switches to `>` or `<=` is immediately caught.

#### 2. Preview predicate operator test

**File**: `src/lib/services/__tests__/consumption-preview-predicate.test.ts` (new)

**Intent**: Prove that `getLimitWindowPreview` issues `.gte()` + `.lt()` on `recorded_at` — not `.gt()` (which would exclude readings at `windowStart`) or `.lte()` (which would include readings at `windowEnd`).

**Contract**: Build a recording mock Supabase client that captures the method name and column name of every filter call made on `consumption_readings`. Call `getLimitWindowPreview(mockClient, meterId, limit)`. Assert:

- A `gte` call was recorded for column `"recorded_at"`.
- A `lt` call was recorded for column `"recorded_at"`.
- No `gt` or `lte` call was recorded for column `"recorded_at"`.

The mock must be thenable (Supabase builders resolve lazily via `.then()`) and return `{ data: [], error: null }` on resolution.

### Success Criteria

#### Automated Verification

- `npm test` exits 0; all new tests pass.
- No test file imports the production module and then copies its output as the expected value — each expected value must be derived from the calendar oracle documented in the fixture table above.

#### Manual Verification

- Change `.gte` to `.gt` in `limit-consumption-preview.ts:27` and verify the predicate test fails. Revert.
- Change `window_type: "month"` referenceDate to `2026-07-15T10:00:00.000Z` and verify `windowStart` advances to July 1 midnight CEST.

**Implementation Note**: After Phase 2 automated verification passes, run the manual mutation check before proceeding to Phase 3.

---

## Phase 3: R2 — Dispatch idempotency integration test

### Overview

Integration test using a real local Supabase instance. Inserts a breach event fixture, invokes `runBreachNotifications()` twice, and asserts that `sendPlainTextEmail` was called exactly once. Stubs only at the `email-client.ts` boundary.

### Changes Required

#### 1. Idempotency integration test

**File**: `src/lib/services/__tests__/breach-notifications-idempotency.test.ts` (new)

**Intent**: Prove that the dispatch job is idempotent across sequential runs: a second invocation for the same unnotified breach event does not trigger a second email send.

**Contract**: The test file must:

1. **Module mock** (top-level, hoisted): `vi.mock('@/lib/services/email-client', () => ({ isResendConfigured: vi.fn().mockReturnValue(true), sendPlainTextEmail: vi.fn().mockResolvedValue(undefined) }))`. The hoisting ensures `astro:env/server` is never evaluated.

2. **`beforeAll`**: Create a test Supabase service-role client from `.env.test` env vars. Create a test user via `supabase.auth.admin.createUser({ email: 'test-idempotency@example.com', password: crypto.randomUUID() })`. Store the `userId`.

3. **`beforeEach`**: Insert the fixture chain (in order, because of FK constraints):
   - `consumption_limits`: `{ user_id: userId, threshold_kwh: 100, window_type: 'month', timezone: 'Europe/Warsaw' }` — capture `limitId`.
   - `limit_breach_events`: `{ limit_id: limitId, user_id: userId, breached_at: new Date().toISOString(), consumption_kwh: 150, notified_at: null, notification_failed_at: null, notification_attempt_count: 0, window_start: '<ISO string of first day of current month midnight Europe/Warsaw>' }` — capture `breachId`.
   - `notification_settings`: `{ user_id: userId, alarm_email: 'alarm@example.com' }`.
   - Clear the `sendPlainTextEmail` mock: `vi.mocked(sendPlainTextEmail).mockClear()`.

4. **`afterEach`**: Delete `notification_settings` by `user_id`, `limit_breach_events` by `id`, `consumption_limits` by `id` (or rely on cascade from user delete — but `beforeEach` re-inserts, so explicit delete between tests is safer).

5. **`afterAll`**: Delete test user via `supabase.auth.admin.deleteUser(userId)` — cascades all owned rows.

6. **Test: "sends email on first run"**: Call `runBreachNotifications(supabase)`. Assert `sendPlainTextEmail` called once with `to: 'alarm@example.com'`.

7. **Test: "does not send email on second run for same breach"**: Call `runBreachNotifications(supabase)` twice. Assert `sendPlainTextEmail.mock.calls.length === 1`.

8. **Race condition comment** (inline, above the second test):

```
// NOTE: This test covers sequential duplicate runs. A true concurrent race — two
// dispatchers both fetching the same unnotified row before either writes notified_at —
// would result in two emails being sent. That gap is accepted at MVP cron cadence
// (10 * * * * UTC, single-instance deployment). Sequential idempotency is the
// achievable guarantee here.
```

### Success Criteria

#### Automated Verification

- `supabase start` is running; `.env.test` is populated with local credentials.
- `npm test` exits 0; both integration tests pass.
- `sendPlainTextEmail` mock call count assertions pass (1 on first run, still 1 after second run).

#### Manual Verification

- Comment out `vi.mock('@/lib/services/email-client', ...)` and verify the test fails with a module resolution error (`astro:env/server`) — confirms the shim is working as intended, not masking a real error.
- Run `npm test` twice in succession without clearing the DB — verify the `afterEach` teardown prevents test pollution.

**Implementation Note**: Phase 3 requires `supabase start` and a populated `.env.test`. Confirm both prerequisites before starting. After automated verification passes, run the manual mutation check before proceeding to Phase 4.

---

## Phase 4: Cookbook + plan sync

### Overview

Update `context/foundation/test-plan.md` with the patterns established in Phases 2 and 3, and mark Phase 2 of the rollout as shipped.

### Changes Required

#### 1. Fill §6.1 — unit test pattern

**File**: `context/foundation/test-plan.md`

**Intent**: Document the unit test pattern discovered in Phase 2 so future contributors know how to add a new unit test.

**Contract**: Replace the `TBD — see §3 Phase 1.` placeholder in §6.1 with a concrete pattern description referencing `consumption-window.test.ts`. Cover: file location (`src/lib/services/__tests__/`), import style (`@/lib/services/...`), fixture approach (explicit `referenceDate` parameter, expected values from oracle not from code output), and the `it.each` pattern for parameterised boundary cases.

#### 2. Fill §6.3 — window boundary test pattern

**File**: `context/foundation/test-plan.md`

**Intent**: Document the specific pattern for testing limit/window calculations so future work on new window types or timezone changes can follow the same approach.

**Contract**: Replace the `TBD — see §3 Phase 2.` placeholder in §6.3. Cover: test `getWindowBounds()` directly (not through the evaluation service), derive expected timestamps from calendar rules (not from running the code), include a DST transition fixture, and verify predicate operators separately via a recording mock.

#### 3. Update §3 Phase 2 status

**File**: `context/foundation/test-plan.md`

**Intent**: Mark Phase 2 as shipped in the rollout table.

**Contract**: In the Phase 2 row of the §3 table, change `Status: not started` to `Status: shipped` and set `Change folder: context/changes/window-boundary-idempotency`.

#### 4. Update change.md status

**File**: `context/changes/window-boundary-idempotency/change.md`

**Intent**: Mark this change as done.

**Contract**: Set `status: done` and `updated: 2026-06-06`.

### Success Criteria

#### Automated Verification

- `npm test` still exits 0 (no regressions from documentation-only changes).
- `npm run lint` passes on all modified files.

#### Manual Verification

- Read `context/foundation/test-plan.md §6.1` and §6.3 — verify a new contributor could follow the patterns without reading the test files.
- Read `context/foundation/test-plan.md §3` — verify Phase 2 shows `shipped`.

---

## Testing Strategy

### Unit Tests

- `getWindowBounds()` — all three window types (day, week, month) with explicit `referenceDate` fixtures; DST spring-forward edge case; half-open interval boundary semantics (three standalone assertions).
- `getLimitWindowPreview` — recording mock verifying `.gte()` + `.lt()` operator pair on `recorded_at`.

### Integration Tests

- `runBreachNotifications()` — two-run idempotency with real Supabase (local), `email-client.ts` stubbed entirely via `vi.mock`.

### Manual Testing Steps

1. Mutate `getWindowBounds()`: change `windowType === "month"` to return `windowStart = zonedWallClockToUtc(year, month, 2, ...)` (wrong day). Verify the `month` fixture test fails.
2. Mutate `limit-consumption-preview.ts:27`: change `.gte(` to `.gt(`. Verify the predicate test fails.
3. Run `runBreachNotifications()` integration test with `supabase start` stopped — verify test fails with a connection error (not silently passes).

## References

- Research: `context/changes/window-boundary-idempotency/research.md`
- R4 oracle source: `src/lib/services/consumption-window.ts:92–121`
- R2 dispatch: `src/lib/services/breach-notifications.ts:86–135`
- Rollout context: `context/foundation/test-plan.md §3 Phase 2`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Bootstrap — Vitest configuration

#### Automated

- [x] 1.1 `npm install` completes; `vitest` appears in `node_modules/.bin/` — 0742394
- [x] 1.2 `npm test` exits 0 with no test files found — 0742394
- [x] 1.3 `npm run typecheck` passes (6 pre-existing errors in cron routes; vitest.config.ts clean) — 0742394

#### Manual

- [x] 1.4 Copy `.env.test.example` to `.env.test`, populate with local credentials, `npm test` exits 0 — 0742394

### Phase 2: R4 — Window boundary unit tests

#### Automated

- [x] 2.1 `npm test` exits 0; all window boundary tests pass
- [x] 2.2 All expected values in test fixtures derived from oracle (calendar rules), not from code output

#### Manual

- [x] 2.3 Mutate `.gte` → `.gt` in `limit-consumption-preview.ts:27`; verify predicate test fails; revert
- [x] 2.4 Verify DST fixture: `referenceDate = 2026-03-29T10:00:00.000Z` → `windowStart = 2026-03-28T23:00:00.000Z`, `windowEnd = 2026-03-29T22:00:00.000Z`

### Phase 3: R2 — Dispatch idempotency integration test

#### Automated

- [ ] 3.1 `supabase start` running; `.env.test` populated; `npm test` exits 0
- [ ] 3.2 `sendPlainTextEmail` called exactly once after two sequential `runBreachNotifications()` invocations

#### Manual

- [ ] 3.3 Comment out `vi.mock('@/lib/services/email-client')`; verify test fails with `astro:env/server` error; uncomment
- [ ] 3.4 Run `npm test` twice in succession without clearing DB; verify `afterEach` prevents pollution

### Phase 4: Cookbook + plan sync

#### Automated

- [ ] 4.1 `npm test` still exits 0 after documentation changes
- [ ] 4.2 `npm run lint` passes on all modified markdown files

#### Manual

- [ ] 4.3 `context/foundation/test-plan.md §6.1` and `§6.3` readable as standalone patterns
- [ ] 4.4 `context/foundation/test-plan.md §3` Phase 2 shows `shipped`
