# Auth Boundary + CI Gate — Plan Brief

> Full plan: `context/changes/auth-boundary-ci-gate/plan.md`
> Research: `context/changes/auth-boundary-ci-gate/research.md`

## What & Why

R6 in the test plan: an unauthenticated caller should never be able to read or write `/api/limits` or `/api/notifications`. The enforcement exists in code today but there are zero tests that would catch a regression — a developer adding a route to the middleware exemption list, or forgetting `requireUser()` on a new method, would be invisible. This plan closes that gap and gates the tests on every PR.

## Starting Point

Auth is already implemented at two layers: middleware (`src/middleware.ts:31`) rejects any `/api/*` request without a session cookie unless the path is in `PUBLIC_API_PREFIXES`, and every handler calls `requireUser(locals)` before doing any work. Neither layer has a negative test. CI only runs `lint` + `build` — no test step exists.

## Desired End State

Ten tests run on every PR. Four of them would fail if auth were removed from the limits or notifications handlers. Six test the middleware allowlist — they would fail if `/api/limits` or `/api/notifications` were accidentally added to `PUBLIC_API_PREFIXES`. CI blocks merges on test failure.

## Key Decisions Made

| Decision                      | Choice                               | Why (1 sentence)                                                                                                                                       | Source          |
| ----------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| CI test scope                 | `vitest run` (Node config only)      | Workers config needs `SUPABASE_SERVICE_ROLE_KEY` not yet in GitHub secrets; unit tests cover R6 fully                                                  | Plan            |
| `isPublicApiRoute` visibility | Export it                            | Enables a clean parameterised test of the allowlist — the exact regression the plan is protecting against                                              | Plan            |
| Test layer                    | Unit + handler integration           | `requireUser()` unit tests cover the guard function; handler-level tests verify the actual Astro route returns 401 — both layers checked independently | Research + Plan |
| Request mock strategy         | Minimal `{ locals: { user: null } }` | `requireUser(locals)` returns before any async DB work in the unauthenticated path — no Supabase mock needed                                           | Research        |

## Scope

**In scope:**

- Export `isPublicApiRoute` from `src/middleware.ts`
- Unit tests: `requireUser()` behaviour + parameterised `isPublicApiRoute` URL checks
- Handler integration tests: unauthenticated `GET`/`POST` to limits and notifications → assert 401
- `test:unit` npm script + one CI step in `ci.yml`

**Out of scope:**

- Changes to existing auth implementation
- Tests for authenticated paths
- Workers vitest config in CI (needs secret provisioning)
- Playwright / E2E (Phase 5)
- `/api/cron/` exemption tests (separate auth mechanism)

## Architecture / Approach

No new infrastructure. Phase 1 exports one function and adds a standard Vitest unit test file under `src/lib/__tests__/`. Phase 2 adds a handler test file under `src/pages/api/__tests__/` — imports the Astro handler functions directly and calls them with a minimal mock context (no HTTP server). Phase 3 adds one npm script and one YAML line.

## Phases at a Glance

| Phase                        | What it delivers                                               | Key risk                                                                              |
| ---------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1. Export + unit tests       | `requireUser()` and allowlist verified by 6 unit tests         | `isPublicApiRoute` import path may need `@/middleware` alias check                    |
| 2. Handler integration tests | 4 tests calling Astro handlers directly with null-user context | `astro:env/server` transitive import — covered by existing shim in `vitest.config.ts` |
| 3. CI gate                   | `npm run test:unit` runs on every PR                           | None — no new secrets required                                                        |

**Prerequisites:** Phases 1 and 2 must be complete before Phase 3 (CI should go green on the first run, not fail due to missing tests).  
**Estimated effort:** ~1 session across 3 small phases.

## Open Risks & Assumptions

- `@/middleware` alias resolves in Vitest — the `@/` alias is wired to `src/` in `vitest.config.ts`; `src/middleware.ts` sits at the root of `src/`, so `import { isPublicApiRoute } from "@/middleware"` should resolve. Verify at Phase 1.
- `astro sync` must run before `npm run test:unit` in CI — already present in the existing CI job (`npx astro sync` at line 19), so the new test step (added after it) inherits the generated types.

## Success Criteria (Summary)

- `npm run test:unit` passes locally with 10 named tests visible in output
- A PR with a deliberate auth regression (e.g. commented-out `requireUser`) is blocked by CI
- CI job log shows test names, not just "0 tests passed"
