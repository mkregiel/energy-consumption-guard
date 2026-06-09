# Auth Boundary + CI Gate — Implementation Plan

## Overview

Phase 4 of the test rollout (R6). Auth enforcement on `/api/limits` and `/api/notifications` is already implemented in code (middleware + `requireUser()`) but completely unverified by tests. This plan adds negative-path tests that would catch a future regression, and wires the unit test run into the PR gate on CI.

## Current State Analysis

Auth is implemented at two layers:

1. **Middleware** (`src/middleware.ts:31`) — rejects any `/api/*` request without a valid Supabase session unless the path is in `PUBLIC_API_PREFIXES = ["/api/auth/", "/api/cron/"]`
2. **Handler** — `requireUser(locals)` called at the top of every exported method in both target handlers (limits: L19, L38; notifications: L18, L37)

`requireUser` lives in `src/lib/auth-guard.ts:9-15` and returns `User | Response` — callers must do an `instanceof Response` guard. The helper `isPublicApiRoute` in `src/middleware.ts` is **not exported**, preventing direct unit testing of the allowlist.

CI (`ci.yml`) runs `lint` + `build` but has no test step. `playwright.yml` is intentionally `workflow_dispatch`-only (Phase 5). `package.json` has `test:ci` (both vitest configs) but no script for just the Node unit config.

## Desired End State

- Four assertions exist that fail if any future change removes auth protection from `/api/limits` or `/api/notifications`
- A parameterised test exists over `isPublicApiRoute` that fails if a developer accidentally adds a config route to the allowlist
- Every PR to `master` runs `vitest run` in CI before merging — using only the Node vitest config, requiring no additional GitHub secrets

### Key Discoveries

- `isPublicApiRoute` must be exported to enable clean allowlist tests (`src/middleware.ts:8`)
- Handler tests can use a minimal mock `{ locals: { user: null } }` — `requireUser(locals)` is called before any async DB work, so the unauthenticated code path never reaches `createClient` (`src/pages/api/limits/index.ts:19`, `src/pages/api/notifications/index.ts:18`)
- The `astro:env/server` virtual module is already shimmed by the plugin in `vitest.config.ts` — no extra mock needed for handler imports
- `vitest.config.ts` excludes workers tests (`src/lib/services/__tests__/breach-notifications*.test.ts`) — `vitest run` with the default config is safe to add to CI without needing `SUPABASE_SERVICE_ROLE_KEY` or `CRON_SECRET`

## What We're NOT Doing

- No changes to the existing auth implementation — enforcement is already correct
- No tests for authenticated paths on limits/notifications (that's integration test territory; out of scope for Phase 4)
- No wiring of the workers vitest config into CI (requires secret provisioning; deferred)
- No changes to `playwright.yml` (Phase 5)
- No test for the `/api/cron/` exemption — cron auth is a separate concern (`assertCronAuthorized`) not scoped to R6
- No `requireUserRedirect` tests (used only by `/api/tuya/oauth/start` which is out of R6 scope)

## Implementation Approach

Three small, sequential phases. Phase 1 makes the internals testable and adds unit coverage. Phase 2 adds handler-level integration tests calling Astro handler functions directly with a minimal context mock. Phase 3 adds a `test:unit` npm script and one CI step.

---

## Phase 1: Export `isPublicApiRoute` + auth-guard unit tests

### Overview

Makes `isPublicApiRoute` testable by exporting it, then writes unit tests covering both `requireUser()` behaviour and the URL allowlist — the two places where a future regression could silently remove auth protection.

### Changes Required

#### 1. Export `isPublicApiRoute`

**File**: `src/middleware.ts`

**Intent**: Make `isPublicApiRoute` part of the module's public surface so tests can import it directly.

**Contract**: Change `const isPublicApiRoute` → `export const isPublicApiRoute` at line 8. No other change to the function body or the middleware handler.

#### 2. New unit test file for auth-guard + allowlist

**File**: `src/lib/__tests__/auth-guard.test.ts`

**Intent**: Verify that `requireUser()` returns 401 when `locals.user` is null, returns the user object when it is set, and that `isPublicApiRoute` correctly classifies every URL relevant to R6.

**Contract**: Three test groups:

- `requireUser` with `{ user: null }` → `instanceof Response` with `status === 401`
- `requireUser` with a stub user object → the same object returned
- `it.each` over these URL paths with expected boolean:

| path                        | expected |
| --------------------------- | -------- |
| `/api/limits`               | `false`  |
| `/api/limits/`              | `false`  |
| `/api/notifications`        | `false`  |
| `/api/notifications/`       | `false`  |
| `/api/auth/signin`          | `true`   |
| `/api/cron/evaluate-limits` | `true`   |

Import `requireUser` from `@/lib/auth-guard`; import `isPublicApiRoute` from `@/lib/middleware` (the re-export path) — or directly from `@/middleware` if Vitest resolves it. Use `User` type from `@supabase/supabase-js` for the stub (or cast `as unknown as User`). No mocks needed — these are pure functions.

### Success Criteria

#### Automated Verification

- `npx vitest run src/lib/__tests__/auth-guard.test.ts` — all tests pass
- `npm run lint` — no new lint errors
- TypeScript: `requireUser` call in the test compiles without `any` escape hatches

#### Manual Verification

- Temporarily set `user: null` to `user: {} as User` in one test and confirm it fails (sanity-check that the test is testing the right thing)

---

## Phase 2: Handler integration tests (unauthenticated HTTP-level)

### Overview

Call the exported `GET` and `POST` functions from the limits and notifications handlers directly, passing a minimal `APIContext` mock with `locals.user = null`. Assert all four paths return a 401 Response. This verifies the dual-layer guarantee at the handler level without spinning up an HTTP server.

### Changes Required

#### 1. New handler integration test file

**File**: `src/pages/api/__tests__/auth-boundary.test.ts`

**Intent**: Prove that unauthenticated callers cannot read or write `/api/limits` or `/api/notifications`. Tests call the handler functions directly — the pattern is identical to testing any other plain async function that returns a `Response`.

**Contract**: Four `it` blocks (one per handler + method):

```
describe("unauthenticated requests are rejected", () => {
  const unauthCtx = { locals: { user: null } } as unknown as APIContext;

  it("GET /api/limits returns 401", ...)
  it("POST /api/limits returns 401", ...)
  it("GET /api/notifications returns 401", ...)
  it("POST /api/notifications returns 401", ...)
})
```

Import `{ GET, POST } from "@/pages/api/limits/index"` and `from "@/pages/api/notifications/index"`. Each test calls the handler with `unauthCtx`, awaits the Response, and asserts `response.status === 401`. No Supabase mock needed — `requireUser(locals)` returns before any DB call in the unauthenticated path.

The `astro:env/server` shim in `vitest.config.ts` handles the virtual module import that both handler files transitively require — no extra `vi.mock` needed.

### Success Criteria

#### Automated Verification

- `npx vitest run src/pages/api/__tests__/auth-boundary.test.ts` — all four tests pass
- `npm run lint` — no new lint errors

#### Manual Verification

- Comment out one `requireUser` call in a handler, re-run tests, confirm that test fails — then restore. This confirms the test is actually exercising the auth guard and not passing vacuously.

---

## Phase 3: Wire unit tests into CI

### Overview

Add a `test:unit` script (just the Node vitest config, no workers pool, no extra secrets) and add one step to the CI job that runs it on every PR.

### Changes Required

#### 1. Add `test:unit` script

**File**: `package.json`

**Intent**: Give CI a named script for just the Node vitest config so the YAML step is readable and the script is reusable locally.

**Contract**: Add `"test:unit": "vitest run"` to the `scripts` object alongside the existing `test`, `test:ci`, and `test:watch` entries.

#### 2. Add test step to CI job

**File**: `.github/workflows/ci.yml`

**Intent**: Run all unit and service tests on every push and PR to `master`. The step runs after `astro sync` (which generates type declarations required by the Astro shim in `vitest.config.ts`) and before `lint`.

**Contract**: Insert between the `astro sync` step and the `lint` step:

```yaml
- run: npm run test:unit
```

No additional `env:` block needed — `vitest.config.ts` shims `astro:env/server` and the Node-config tests do not touch Supabase or the workers pool.

### Success Criteria

#### Automated Verification

- `npm run test:unit` passes locally (all phases 1 + 2 tests included)
- Push to a branch and open a PR — CI job shows a green `npm run test:unit` step in the `ci` job log
- A deliberate test failure (e.g., temporarily flip one assertion) causes the CI job to fail and blocks the PR

#### Manual Verification

- Inspect the CI run log and confirm the test step output shows the auth-boundary tests by name (not just "0 tests passed")

---

## Testing Strategy

### Unit Tests

- `requireUser()` with null user → 401 Response (checks `response.status`)
- `requireUser()` with a stub user → the same user reference returned
- `isPublicApiRoute` — parameterised over 6 paths (4 config routes → false, 2 exempt routes → true)

### Integration Tests

- `GET /api/limits` unauthenticated → 401
- `POST /api/limits` unauthenticated → 401
- `GET /api/notifications` unauthenticated → 401
- `POST /api/notifications` unauthenticated → 401

### Manual Testing Steps

1. Run `npm run test:unit` locally — all 10 tests pass
2. Per-phase sanity checks: temporarily break one guard and confirm the relevant test fails
3. After Phase 3: open a PR, confirm CI job passes; break a test on the branch, confirm CI fails

## References

- Research: `context/changes/auth-boundary-ci-gate/research.md`
- Middleware: `src/middleware.ts:5-33`
- Auth guard: `src/lib/auth-guard.ts:9-27`
- Limits handler: `src/pages/api/limits/index.ts`
- Notifications handler: `src/pages/api/notifications/index.ts`
- CI workflow: `.github/workflows/ci.yml`
- Vitest config: `vitest.config.ts`
- Existing test pattern reference: `src/lib/services/__tests__/consumption-window.test.ts`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Export + auth-guard unit tests

#### Automated

- [x] 1.1 `vitest run src/lib/__tests__/auth-guard.test.ts` — all tests pass
- [x] 1.2 `npm run lint` — no new errors

#### Manual

- [ ] 1.3 Temporarily break one test assertion; confirm it fails; restore

### Phase 2: Handler integration tests

#### Automated

- [ ] 2.1 `vitest run src/pages/api/__tests__/auth-boundary.test.ts` — all four tests pass
- [ ] 2.2 `npm run lint` — no new errors

#### Manual

- [ ] 2.3 Comment out one `requireUser` call; confirm the corresponding test fails; restore

### Phase 3: Wire unit tests into CI

#### Automated

- [ ] 3.1 `npm run test:unit` passes locally with all 10 tests
- [ ] 3.2 CI job on a PR shows green `npm run test:unit` step

#### Manual

- [ ] 3.3 Break a test on a branch; confirm CI fails and PR is blocked
