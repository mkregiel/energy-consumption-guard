# Repository Guidelines

Stack, setup, production deploy @README.md. Agents specific rules are below.

## Hard Rules

- Full SSR only (`output: "server"` in @astro.config.mjs). New API routes must export `const prerender = false`.
- API routes use uppercase `GET`/`POST` exports and validate input with zod.
- Non-auth API routes (`/api/*` except `/api/auth/*`) are protected by middleware; handlers must still call `requireUser()` from @src/lib/auth-guard.ts (defense in depth). Use `apiJsonError` / `apiJsonSuccess` from @src/lib/services/api-response.ts for JSON responses. Only `/api/auth/signin`, `/api/auth/signup`, and `/api/auth/signout` may exist under `/api/auth/` — do not add sibling auth API routes without a security review and middleware allowlist update.
- No Next.js directives (`"use client"`) in React; extract hooks to `src/components/hooks/`.
- Merge Tailwind classes with `cn()` from @src/lib/utils.ts — never concatenate class strings.
- New Supabase tables need migrations in `supabase/migrations/` named `YYYYMMDDHHmmss_description.sql` with RLS enabled.
- Never commit secrets; copy @.env.example to `.env` (Node) or `.dev.vars` (Cloudflare local dev).

## Security & Configuration

- Server-only secrets @README.md#supabase-configuration.

## Project Structure

- `context/` — shaping docs (PRD, shape-notes)
- Broader layout: @README.md

## Coding Style & Naming Conventions

- Path alias (@tsconfig.json)
- Unused identifiers prefixed with `_` are allowed (@eslint.config.js)
- Shared entity/DTO types belong in `src/types.ts`
- Services and helpers go in `src/lib/` or `src/lib/services/`

## Testing Guidelines

### Unit / Integration tests — Vitest

- Runner: **Vitest** (`npm test` → `vitest run --passWithNoTests`, `npm run test:ci` → `vitest run`)
- Config: @vitest.config.ts — `environment: "node"`, includes `src/**/*.test.ts`
- Path alias `@` maps to `src/` (same as tsconfig)
- Global setup: @vitest.setup.ts — loads `.env.test` into `process.env` before workers start
- Integration tests that hit a real Supabase instance require a `.env.test` file (copy from @.env.example, fill in test-project credentials); without it they fail with a clear error
- `astro:env/server` is shimmed in vitest.config.ts — import env vars from there normally in source, no special handling needed in tests
- Test files live next to the code they test under a `__tests__/` subdirectory, e.g. `src/lib/services/__tests__/`

### E2E tests

No E2E test runner is configured yet (`tests/` directory does not exist).

### Mutation testing — Stryker

Config: @stryker.config.json — runner: `vitest`, reporters: `html + clear-text + progress`, `coverageAnalysis: perTest`

Run selectively against a changed module:
```
npx stryker run --mutate "src/lib/services/my-service.ts"
# or with line range:
npx stryker run --mutate "src/lib/services/my-service.ts:10-80"
```

Do not run Stryker on the whole repo in CI. Review survived mutants one by one — add an assertion only when the mutant represents a user-visible or business-relevant bug.

## Mutation testing

Repo uses Stryker for selective mutation testing on risk-critical modules.
Run it only for code covered by the current change or a risk from test-plan.md,
prefer narrowed scope with --mutate "path/to/file.ts:start-end", and do not chase
100% mutation score. Survived mutants should be reviewed one by one: add an
assertion only when the mutant represents a user-visible or business-relevant bug.

## Commit & Pull Request Guidelines

Commit messages: tryb rozkazujący, krótki subject (≤72 zn.), opcjonalne body; wzoruj się na ostatnich wpisach z git log --oneline (np. Add session guard to middleware, Fix zod validation on POST /api/...). Target branch is `master`. PRs must pass CI lint and build; configure `SUPABASE_URL` and `SUPABASE_KEY` as GitHub repository secrets.
