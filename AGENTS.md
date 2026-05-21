# Repository Guidelines

Stack, setup, production deploy @README.md. Agents specific rules are below.

## Hard Rules

- Full SSR only (`output: "server"` in @astro.config.mjs). New API routes must export `const prerender = false`.
- API routes use uppercase `GET`/`POST` exports and validate input with zod.
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

No test runner is configured. Do not add test infrastructure unless explicitly requested.

## Commit & Pull Request Guidelines

Commit messages: tryb rozkazujący, krótki subject (≤72 zn.), opcjonalne body; wzoruj się na ostatnich wpisach z git log --oneline (np. Add session guard to middleware, Fix zod validation on POST /api/...). Target branch is `master`. PRs must pass CI lint and build; configure `SUPABASE_URL` and `SUPABASE_KEY` as GitHub repository secrets.
