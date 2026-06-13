# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## In-app window sum: accept JS reduce for MVP, plan DB aggregate for follow-up

**Context:** src/lib/services/limit-consumption-preview.ts

**Problem:** Preview queries fetch all kwh_delta rows in the current window into memory and reduce them in TypeScript. For month windows with many readings this grows unbounded, transferring unnecessary data.

**Rule:** When summing a column over a bounded time range for a single meter, prefer a DB aggregate (PostgREST column aggregation or RPC) over fetching all rows client-side. If the JS-reduce approach is used intentionally (e.g., MVP, RLS constraints), add a comment naming the constraint and a follow-up slice.

**Applies to:** Any service that sums consumption readings for preview or reporting.

## Exporting from an Astro-virtual-module-importing file requires a matching Vitest shim

**Context:** vitest.config.ts, src/middleware.ts (auth-boundary-ci-gate, Phase 1)

**Problem:** `src/middleware.ts` imports `defineMiddleware` from `astro:middleware`, a virtual module only resolvable inside Astro's runtime. Before Phase 1, nothing under `src/lib/` imported `middleware.ts`, so Vitest never had to load it. Exporting `isPublicApiRoute` and importing it from a new test file caused the whole module — including its `astro:middleware` import — to load under Vitest for the first time, failing with "Cannot find package 'astro:middleware'".

**Rule:** Before exporting a symbol from a file for unit-test use, check whether that file imports any `astro:*` virtual modules. If so, add a matching shim to vitest.config.ts (mirroring the existing astro:env/server pattern) in the same change.

**Applies to:** Any change that exports a new symbol from a file under src/ for direct unit testing, where that file (or its import chain) touches astro:middleware, astro:env/server, astro:content, etc.

## E2E Supabase cleanup helpers need SUPABASE*LOCAL*\* vars not always available in sandboxed worktrees

**Context:** e2e/tuya-oauth-connect.spec.ts:55 (afterAll calls deleteTuyaOAuthTokenForTestUser())

**Problem:** The afterAll cleanup requires SUPABASE_LOCAL_URL and SUPABASE_LOCAL_SERVICE_ROLE_KEY in .env.test, obtained via `npx supabase status`. In sandboxed worktrees without Docker access, this command fails ("must be run with elevated privileges"), so these vars can't be populated and the error-path test fails on all browsers.

**Rule:** Newer Supabase CLI versions (`npx supabase status`) no longer print a JWT-based `service_role` key — they print a `Secret` key (`sb_secret_...`) instead, which is its drop-in replacement for admin operations (`auth.admin.*`, RLS bypass). When a `.env.test.example` var is documented as coming from `npx supabase status` and that command's "Authentication Keys" section has no `service_role`/`anon` row, use the `Secret`/`Publishable` key pair instead — the env var _names_ in code (e.g. `SUPABASE_LOCAL_SERVICE_ROLE_KEY`) don't need to change, just the values. Also note `SUPABASE_URL=http://127.0.0.1:54321` in `.env`/`.dev.vars` already points at the same local instance `supabase status` reports.

**Applies to:** Any e2e test or script that reads `SUPABASE_LOCAL_URL`/`SUPABASE_LOCAL_SERVICE_ROLE_KEY` (or similarly-named local Supabase admin credentials) from `.env.test`.

## waitForLoadState("networkidle") is required before filling Astro client:load forms

**Context:** e2e/global-setup.ts, e2e/auth-redirect.spec.ts, e2e/dashboard-forms.spec.ts (lines using networkidle before form interaction)

**Problem:** Playwright docs discourage waitForLoadState("networkidle") as flaky/discouraged. However, this repo's pages use Astro client:load hydration — if a test fills a form input before client-side React finishes mounting, the remount wipes the typed value, causing flaky failures.

**Rule:** When a test fills inputs on a page with Astro client:load components immediately after navigation, call `await page.waitForLoadState("networkidle")` first to let hydration complete before interacting with the form. This is a deliberate exception to the general "avoid networkidle" guidance.

**Applies to:** Any new e2e test that navigates to a page and immediately fills/interacts with a client:load-hydrated form.

## Test cleanup helpers may use listUsers() without filters against local Supabase

**Context:** e2e/lib/tuya-cleanup.ts:28

**Problem:** supabase.auth.admin.listUsers() fetches all users to find one by email, with no pagination/filter. Against a production or large database this would be expensive/unbounded.

**Rule:** GoTrue's admin `listUsers()` has no email-filter param, only `{ page, perPage }` pagination. When looking up a user by email in a test helper, pass an explicit `perPage` cap (e.g. 200) with a comment noting the API limitation, instead of relying on the unbounded default page size.

**Applies to:** Any test or script that calls `supabase.auth.admin.listUsers()` to find a user by email against a local/dev database.
