# Scripted Code Review Agent (Cursor SDK) — Plan Brief

> Full plan: `context/changes/code-review-agent/plan.md`

## What & Why

We're building a minimal, locally-runnable code review agent: `git diff | npx tsx scripts/review.ts`. It scores a diff on five criteria, returns a binding pass/fail verdict and a Markdown summary, all as validated JSON. This is the 10xDevs M5L2 lesson scope (script + SDK), built on `@cursor/sdk` to align with the team's Cursor Team subscription — CI/CD wiring is a separate future change (M5L3).

## Starting Point

The repo (`10x-astro-starter`, Astro + Cloudflare) has no code-review tooling. It already has `tsx` (devDependency) and `zod ^4.4.3` (dependency), and one existing flat script (`scripts/seed-test-breach.ts`) establishing the `npx tsx scripts/*.ts` invocation convention we'll follow.

## Desired End State

Piping a `git diff` into the script returns a JSON object (five 1-10 scores, `verdict: pass|fail`, Markdown `summary`) on stdout, with the process exit code mirroring the verdict. Failures (Cursor API errors, malformed output) fail loudly and distinctly from a real "fail" code review — never silently fabricated.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Repo access for the agent | Read-only, via `local.cwd` + sandboxed `workspace_readonly` | User wants better review quality from repo context, but file mutation must be impossible, not just discouraged |
| Model | `CURSOR_REVIEW_MODEL` env var, default `composer-2.5` | Matches Cursor SDK docs' example model and leaves room for future model comparisons (promptfoo, M5L3) without code changes |
| Non-"finished" agent status | Throw and exit 1 with a clear message | Cursor SDK gives no structured-output guarantee; conflating an infra failure with a real "fail" verdict would be dangerous once this feeds a future merge gate |
| Schema/prompt location | `scripts/review/schema.ts` + `scripts/review/prompt.ts`, entry point `scripts/review.ts` | Keeps the SDK-agnostic pieces (criteria, JSON shape, prompt text) reusable for the future CI integration without touching Cursor-specific code |

## Scope

**In scope:**
- `scripts/review/schema.ts` — zod schema for the review JSON shape
- `scripts/review/prompt.ts` — system prompt instructing strict JSON-only output
- `scripts/review.ts` — entry point: stdin diff → `Agent.prompt()` → JSON validation → exit code
- `sandbox.json` — read-only filesystem sandbox config
- `.env.example` entries for `CURSOR_API_KEY` / `CURSOR_REVIEW_MODEL`
- `npm run review` convenience script

**Out of scope:**
- GitHub Actions / CI integration (future change)
- PR title/body input (diff only)
- Composite actions, PR comments, labels
- promptfoo evals / multi-model comparison
- Any write access for the agent
- Retry/backoff logic

## Architecture / Approach

`scripts/review.ts` reads stdin → calls `Agent.prompt(REVIEW_SYSTEM_PROMPT + diff, { apiKey, model, local: { cwd, sandboxOptions: { enabled: true } } })` → strips any markdown fence from `result.result` → `JSON.parse` → `ReviewSchema.safeParse` → prints JSON, exits 0/1 by verdict. `schema.ts` and `prompt.ts` are SDK-agnostic and importable by a future CI script unchanged.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Shared schema and prompt module | `schema.ts` + `prompt.ts`, no SDK call yet | Prose/schema drift between prompt field names and zod schema |
| 2. Cursor SDK integration and entry script | Working `scripts/review.ts` + `sandbox.json` + `@cursor/sdk` dependency | Sandbox not actually enforcing read-only; JSON extraction failing on fenced output |
| 3. Wiring, docs, and end-to-end verification | `npm run review`, `.env.example` docs, real-diff smoke test | npm's own output polluting stdout JSON when piping through `npm run` |

**Prerequisites:** A `CURSOR_API_KEY` (user or service-account) for manual verification steps.
**Estimated effort:** ~1 session across 3 small phases.

## Open Risks & Assumptions

- `sandboxOptions.enabled: true` + root `sandbox.json` with `"workspace_readonly"` is assumed sufficient for true read-only enforcement based on Cursor's docs; this should be confirmed empirically in Phase 2's manual verification (attempt a file-modifying instruction, confirm `git status` stays clean).
- `@cursor/sdk`'s nested `zod ^3.25.0` dependency is assumed to cause no real conflict with the repo's `zod ^4.4.3` (not a peer dependency) — flagged for a quick `npm ls zod` sanity check after install rather than left as a blind assumption.
- Model id `composer-2.5` is taken from current Cursor SDK docs examples; exact available model ids may shift over time (Cursor SDK is public beta per the lesson).

## Success Criteria (Summary)

- `git diff | npx tsx scripts/review.ts` returns schema-valid JSON and a matching exit code on a real diff.
- A Cursor API failure (e.g. missing key) fails loudly and distinctly, never as a fabricated "fail" verdict.
- The agent never modifies files during a review run (verified via `git status`).
