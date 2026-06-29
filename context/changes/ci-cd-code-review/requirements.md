## Overall concept

- GHA workflow run for every new pull request to master
- composite action for the review itself so that main workflow is easy to reason about

## Input parameters

- pull request title
- pull request description (?? cost tradeoff)
- git diff

## Code Review Criteria

Each criterion is scored on a 1–10 scale, where 1 is the worst outcome and 10 is the best.

1. **implementation correctness** — does the code actually do what it claims, handling edge cases and error paths without introducing regressions?
   - _1_: logic is broken, misses obvious edge/error cases, or silently regresses existing behavior.
   - _10_: behaves correctly across happy path, edge cases, and failure modes with no regressions.
   - _Stack-specific_: Astro page/API route returns correct status codes and headers; Supabase `.from()` / `.rpc()` calls handle `{ data, error }` destructuring — unchecked `error` is treated as a correctness bug; Cloudflare Workers bindings (KV, D1, env) are used within platform constraints (no Node-only APIs on the edge).

2. **idiomaticity** — does the code follow the language, framework, and project conventions a fluent reader would expect?
   - _1_: fights the stack's idioms and the repo's established patterns, reads as foreign.
   - _10_: indistinguishable from well-written surrounding code, uses the right idioms naturally.
   - _Stack-specific_: `.astro` for pages/layouts with island architecture (`client:*` directives only where interactivity is needed); React 19 patterns in `.tsx` islands (no legacy class components, proper use of hooks); services under `src/lib/services/` follow established `*-service.ts` naming; Zod for runtime validation; Tailwind v4 utility classes via `class:list` in Astro or `cn()` in React; middleware pattern for auth guards matches existing `src/middleware.ts`.

3. **complexity** — is the solution as simple as the problem allows, without needless abstraction or convolution?
   - _1_: over-engineered or tangled — hard to follow, with accidental complexity that obscures intent.
   - _10_: minimal and clear, the simplest design that solves the problem completely.
   - _Stack-specific_: prefer Astro's built-in server-side rendering over client-side state where possible; avoid wrapping Supabase client in unnecessary abstraction layers; API routes (`src/pages/api/`) should be thin — delegate logic to services.

4. **test / risk coverage** — are the meaningful behaviors and risky paths exercised by tests proportional to their risk?
   - _1_: risky logic ships untested; tests are absent, trivial, or assert nothing useful.
   - _10_: risk-weighted coverage — the parts most likely to break are tested deliberately and well.
   - _Stack-specific_: unit tests (Vitest) for services under `src/lib/services/__tests__/`; Cloudflare Workers tests via `@cloudflare/vitest-pool-workers` config; E2E (Playwright) for critical user journeys; Supabase RPC and edge-case queries deserve integration tests; new Supabase migrations must be exercised by at least one test scenario.

5. **security and safety** — does the change avoid introducing vulnerabilities, leaking secrets, or unsafe handling of untrusted input?
   - _1_: introduces an exploitable flaw, leaks secrets, or trusts untrusted input unsafely.
   - _10_: input is validated, secrets are handled correctly, and no new attack surface is opened.
   - _Stack-specific_: Supabase RLS policies must cover every new table — never bypass RLS with `service_role` key on client-facing paths; API routes behind auth must check `context.locals.user`; Supabase secrets and Tuya OAuth tokens must stay in env vars / Cloudflare secrets, never in client bundles; SQL migrations must not drop columns/tables without a migration path; cron endpoints (`/api/cron/`) must validate the cron auth secret.

6. **documentation** — are non-obvious decisions, public surfaces, and tricky code explained where a reader would need it?
   - _1_: opaque — no comments or docs where they're needed, intent must be reverse-engineered.
   - _10_: just enough docs/comments to explain the "why" without restating the obvious.
   - _Stack-specific_: Supabase migration files should have a comment explaining the purpose of schema changes; new API endpoints need at minimum a JSDoc with expected request/response shape; Cloudflare-specific constraints (e.g. why a Node API can't be used) warrant a one-line comment.

## Parked for later

- business alignment (require broader context)
- architectural fit (require broader context)

## Expected side-effects

- PR comment with summary
- labels: `ai-cr:failed` (red) OR `ai-cr:passed` (green)

## Expected behavior

- on-demand retry when label `ai-cr:review` is added
