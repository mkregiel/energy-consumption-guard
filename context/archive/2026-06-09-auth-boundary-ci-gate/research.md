---
date: 2026-06-09T00:00:00+00:00
researcher: Mariusz Kręgiel
git_commit: 8437ede8c81356883374ce083d60e1a337150939
branch: claude/jolly-bartik-c071b5
repository: energy-consumption-guard
topic: "Auth boundary + CI gate (Phase 4 — R6)"
tags: [research, auth, middleware, ci, github-actions, vitest]
status: complete
last_updated: 2026-06-09
last_updated_by: Mariusz Kręgiel
---

# Research: Auth Boundary + CI Gate (Phase 4 — R6)

**Date**: 2026-06-09  
**Researcher**: Mariusz Kręgiel  
**Git Commit**: 8437ede8c81356883374ce083d60e1a337150939  
**Branch**: claude/jolly-bartik-c071b5  
**Repository**: energy-consumption-guard

## Research Question

What is the current auth enforcement on `/api/limits` and `/api/notifications`? What does the middleware exemption for `/api/cron/` look like, and does it widen the attack surface? What CI exists today, and what is the minimal change needed to wire unit/integration tests into the PR gate?

## Summary

**Auth is already implemented at two layers** — middleware and handler — for both target endpoints. There are no holes in the coverage today. The R6 risk is best characterised as _unverified_: the enforcement exists in code but there are zero negative tests that would catch a future regression (e.g. a developer widening the `PUBLIC_API_PREFIXES` list or forgetting `requireUser()` on a new handler). The Phase 4 job is to write those missing negative-path tests and add `npm run test:ci` to the existing CI job.

**CI gap**: `.github/workflows/ci.yml` runs `lint` + `build` but never calls `npm run test:ci`. Adding one line wires all unit + integration tests into every PR. A separate `playwright.yml` exists but is gated to `workflow_dispatch` only (intentionally disabled until Phase 5 is ready).

## Detailed Findings

### Auth layer 1 — Middleware (`src/middleware.ts`)

```
Line 5:  const PROTECTED_ROUTES = ["/dashboard"];
Line 6:  const PUBLIC_API_PREFIXES = ["/api/auth/", "/api/cron/"];
Line 8:  const isPublicApiRoute = (pathname: string): boolean =>
Line 9:    PUBLIC_API_PREFIXES.some((prefix) => pathname.startsWith(prefix));
Line 31: if (pathname.startsWith("/api/") && !isPublicApiRoute(pathname) && !context.locals.user) {
Line 32:   return unauthorizedResponse();
Line 33: }
```

- Every `/api/*` route is rejected with 401 unless it's in `PUBLIC_API_PREFIXES` **or** the request carries a valid Supabase session cookie.
- `PUBLIC_API_PREFIXES` currently exempts **only** `/api/auth/` and `/api/cron/`. `/api/limits` and `/api/notifications` are NOT in this list — they are protected by middleware.
- The cron exemption (`/api/cron/`) does not widen the user-facing config surface because cron endpoints use their own auth (`assertCronAuthorized()` checking a `CRON_SECRET` header), not user sessions.
- The `unauthorizedResponse()` helper lives in `src/lib/auth-guard.ts` and returns `apiJsonError(401, "UNAUTHORIZED", UNAUTHORIZED_MESSAGE)`.

### Auth layer 2 — Handler-level `requireUser()` (`src/lib/auth-guard.ts`)

```typescript
export const requireUser = (locals: App.Locals): User | Response => {
  if (!locals.user) return unauthorizedResponse();
  return locals.user;
};
```

- Called at the **top of every exported HTTP method** in both target handlers.
- Acts as defense-in-depth: even if middleware were misconfigured, the handler would still reject.
- Pattern is consistent across all user-facing config endpoints.

### Target endpoint coverage

| Endpoint                   | File                                         | Methods   | Middleware layer         | Handler layer                 |
| -------------------------- | -------------------------------------------- | --------- | ------------------------ | ----------------------------- |
| `/api/limits`              | `src/pages/api/limits/index.ts:19,38`        | GET, POST | ✓ (line 31 middleware)   | ✓ `requireUser` at L19, L38   |
| `/api/notifications`       | `src/pages/api/notifications/index.ts:18,37` | GET, POST | ✓ (line 31 middleware)   | ✓ `requireUser` at L18, L37   |
| `/api/meters`              | `src/pages/api/meters/index.ts:22,41`        | GET, POST | ✓                        | ✓ `requireUser` at L22, L41   |
| `/api/tuya/devices`        | `src/pages/api/tuya/devices.ts:12`           | GET       | ✓                        | ✓                             |
| `/api/tuya/sync`           | `src/pages/api/tuya/sync.ts:20`              | POST      | ✓                        | ✓                             |
| `/api/tuya/status`         | `src/pages/api/tuya/status.ts:11`            | GET       | ✓                        | ✓                             |
| `/api/tuya/oauth/callback` | `src/pages/api/tuya/oauth/callback.ts:18`    | POST      | ✓                        | ✓                             |
| `/api/tuya/oauth/start`    | `src/pages/api/tuya/oauth/start.ts:27`       | GET       | ✓                        | ✓ `requireUserRedirect`       |
| `/api/cron/*`              | `src/pages/api/cron/`                        | \*        | **EXEMPT** — intentional | uses `assertCronAuthorized()` |
| `/api/auth/*`              | `src/pages/api/auth/`                        | \*        | **EXEMPT** — intentional | n/a (auth flows)              |

### CI pipeline today (`.github/workflows/ci.yml`)

```yaml
jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npx astro sync
      - run: npm run lint
      - run: npm run build
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_KEY: ${{ secrets.SUPABASE_KEY }}
```

**Missing**: `npm run test:ci` — no test step exists in the current CI job. Tests pass locally but are never gated on PRs.

**`test:ci` script** (from `package.json`):

```
"test:ci": "vitest run && vitest run --config vitest.workers.config.ts"
```

This runs both configs without `--passWithNoTests` — fails on zero matches (stricter than `npm test`).

### Playwright CI workflow (`.github/workflows/playwright.yml`)

```yaml
on:
  # Disabled — re-enable once e2e suite is ready
  workflow_dispatch:
```

Intentionally disabled for auto-triggers. Manual dispatch only. Runs `npx playwright test` against `e2e/` dir. **Do not touch this for Phase 4** — E2E belongs to Phase 5.

### Existing test infrastructure patterns

**Vitest split**:

- `vitest.config.ts` — Node environment; runs `src/**/*.test.ts` **excluding** breach-notification workers tests. Shims `astro:env/server` via a plugin to avoid import errors.
- `vitest.workers.config.ts` — Cloudflare `@cloudflare/vitest-pool-workers` pool; runs only `breach-notifications*.test.ts` inside a real miniflare environment. Reads env from `.env.test`.
- `vitest.setup.ts` — global setup: loads `.env.test` into `process.env` before workers spin up.

**Auth in existing integration tests** (`breach-notifications-idempotency.test.ts`):

- Uses **service role** Supabase client (no user session, no cookies) — appropriate for background job tests.
- Creates real test users via `supabase.auth.admin.createUser()` to populate `user_id` FK columns.
- Mocks only the email HTTP boundary (`sendPlainTextEmail`, `isResendConfigured`).

**What does NOT exist**:

- No test that makes an unauthenticated HTTP request to any `/api/*` endpoint.
- No fixture for simulating a real Astro request + response cycle with or without a session cookie.
- No `*helper*`, `*fixture*`, `*mock*` shared test utilities — all setup is inline.

### How to test the auth boundary (recommended approach)

The auth guard lives entirely in `src/lib/auth-guard.ts` and `src/middleware.ts`. It does **not** require an Astro HTTP server running. The cheapest test is a **unit test** that calls `requireUser()` directly with a mocked `App.Locals` object:

```typescript
// src/lib/__tests__/auth-guard.test.ts
import { requireUser } from "@/lib/auth-guard";

it("returns 401 when locals.user is null", async () => {
  const result = requireUser({ user: null } as App.Locals);
  expect(result).toBeInstanceOf(Response);
  expect((result as Response).status).toBe(401);
});

it("returns the user when locals.user is set", () => {
  const fakeUser = { id: "u1" } as User;
  const result = requireUser({ user: fakeUser } as App.Locals);
  expect(result).toBe(fakeUser);
});
```

For **middleware-level** negative tests (proving the `PUBLIC_API_PREFIXES` allowlist doesn't admit config routes), the test needs to exercise the `isPublicApiRoute` function or the middleware's URL-matching logic. Since `isPublicApiRoute` is not exported, the test options are:

1. Export `isPublicApiRoute` and test it directly (minimal change, pure unit test).
2. Test the middleware handler itself using a mocked `APIContext` with a fake URL — more complete but requires mocking `defineMiddleware` context.

**Recommended**: Option 1 — export `isPublicApiRoute` and write a parameterised unit test covering:

- `/api/limits` → not public (must be rejected)
- `/api/notifications` → not public (must be rejected)
- `/api/cron/evaluate-limits` → public (must be allowed through)
- `/api/auth/signin` → public (must be allowed through)

This covers the exact regression risk: someone adding a config route to `PUBLIC_API_PREFIXES` by mistake.

## Code References

- `src/middleware.ts:5-6` — `PROTECTED_ROUTES` and `PUBLIC_API_PREFIXES` constants
- `src/middleware.ts:31-33` — the API-level 401 gate
- `src/lib/auth-guard.ts:9-15` — `requireUser()` function
- `src/lib/auth-guard.ts:17-27` — `requireUserRedirect()` function
- `src/pages/api/limits/index.ts:19,38` — `requireUser` calls (GET, POST)
- `src/pages/api/notifications/index.ts:18,37` — `requireUser` calls (GET, POST)
- `.github/workflows/ci.yml:20-21` — the lint + build steps where `npm run test:ci` is missing
- `.github/workflows/playwright.yml:5` — `workflow_dispatch` only, intentionally disabled
- `package.json` `scripts.test:ci` — the command to wire into CI

## Architecture Insights

**Dual-layer pattern**: Every user-facing config endpoint has both middleware protection and an explicit `requireUser()` call. This is good defense-in-depth but creates two places where a future regression could occur independently. The test plan's anti-pattern warning — "trusting middleware config without a negative test" — is valid: the dual-layer pattern will silently degrade if either layer is removed without a test catching it.

**`requireUser` returns `User | Response`**: Handlers must check `instanceof Response` after each call and return early. If a handler adds a new method and forgets this check, it will proceed with `undefined` as the user. A lint rule or a stricter type helper (`assertUser`) that throws instead of returning a Response would eliminate this class of bug — but that's out of scope for Phase 4.

**The cron exemption is intentional and bounded**: `/api/cron/` endpoints use `assertCronAuthorized()` (checking a `CRON_SECRET` Bearer token) which is entirely separate from user session auth. The exemption does not create a path for user-data access without authentication.

**CI secrets for test:ci**: The `npm run test:ci` command (both vitest configs) needs `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (for workers integration tests) and `CRON_SECRET` (for cron-auth tests). The existing CI job only injects `SUPABASE_URL` and `SUPABASE_KEY` (anon key). Adding `test:ci` to CI will also require adding `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` as GitHub Actions secrets and wiring them in the env block.

**Alternative: skip workers tests in CI for Phase 4**: The `vitest.config.ts` excludes workers tests, so `vitest run` alone only runs unit + service tests. If the service role secret is not yet in CI, Phase 4 can add just `vitest run` (without the workers config) and defer the workers integration tests to a follow-on. This keeps the CI gate minimal and unblocked.

## Open Questions

1. **Are `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` already stored as GitHub Actions secrets?** If not, `npm run test:ci` (with workers config) will fail in CI. The plan should note that only `vitest run` (non-workers) is safe to add without secret provisioning.
2. **Should `isPublicApiRoute` be exported from `src/middleware.ts`?** Currently unexported, which makes unit-testing the allowlist logic indirect. A one-line change unblocks the cleanest test.
3. **Integration vs. unit for the auth boundary test**: An HTTP-level integration test (actual Astro request to the endpoint) would give higher confidence but requires a running dev server or a request fixture. Given the existing pattern (inline service-role client, no HTTP-level tests), a unit test on `requireUser` + a parameterised test on the URL-matching logic is the right cost × signal trade-off for Phase 4.

## Historical Context

- `context/changes/test-infra-breach-to-email` — Phase 1 shipped. Established vitest split, workers pool, service-role client pattern, and `vi.spyOn` on `fetch` at the HTTP boundary.
- `context/changes/window-boundary-idempotency` — Phase 2 shipped. Established `it.each` parameterised boundary fixtures and the recording Supabase mock builder (relevant pattern for auth unit tests).
- `context/foundation/test-plan.md` §6.4 — "TBD — see Phase 4. Pattern: integration test — unauthenticated request → assert 401/403; authenticated request → assert response shape and DB side-effect." Research confirms the pure-unit approach is cheaper and sufficient for Phase 4.
