---
date: 2026-06-29T18:00:00+02:00
researcher: Claude
git_commit: 00e50e5d6b53354cb03f76e22e49c04253c0d8e4
branch: claude/gracious-thompson-fedd5a
repository: mkregiel/energy-consumption-guard
topic: "CI/CD code review workflow — codebase readiness and implementation strategy"
tags: [research, codebase, ci-cd, code-review, github-actions]
status: complete
last_updated: 2026-06-29
last_updated_by: Claude
---

# Research: CI/CD Code Review Workflow

**Date**: 2026-06-29T18:00:00+02:00
**Researcher**: Claude
**Git Commit**: 00e50e5d6b53354cb03f76e22e49c04253c0d8e4
**Branch**: claude/gracious-thompson-fedd5a
**Repository**: mkregiel/energy-consumption-guard

## Research Question

What is the current state of CI infrastructure, code review tooling, project toolchain, and GitHub API integration in the repo — and what needs to be built to implement the CI/CD code review workflow described in `context/changes/ci-cd-code-review/requirements.md`?

## Summary

The repo has a **working local code review agent** (`scripts/review.ts` using `@cursor/sdk`) with a Zod-validated schema (5 criteria + verdict + summary) and a clean stdin-diff-in/exit-code-out pattern. Two GHA workflows exist (`ci.yml` for CI/deploy, `playwright.yml` for manual E2E) but **neither handles code review, PR comments, labels, or any review automation**. The project toolchain is mature (Node 22, npm, Vitest dual-config, Playwright, ESLint flat config, Prettier, Husky) and the existing `ci.yml` already demonstrates the setup pattern needed.

**Key gaps**: no composite action, no PR comment/label logic, no `ai-cr:*` labels in the repo, schema needs a 6th criterion (`documentation`), and the prompt needs stack-specific rubrics from `requirements.md`.

## Detailed Findings

### 1. Existing CI Infrastructure

**Found** — two workflows in `.github/workflows/`:

- **`ci.yml`** (48 lines) — triggers on push to `master` and PRs to `master`. Jobs: `ci` (checkout → Node 22 → `npm ci` → `astro sync` → unit tests → lint → build) and `deploy` (Cloudflare Wrangler, on push to master only). Secrets: `SUPABASE_URL`, `SUPABASE_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
- **`playwright.yml`** (85 lines) — manual `workflow_dispatch` only. Sets up Supabase local, creates test user, runs Playwright. Uploads report artifact.

**Not found**: no `CODEOWNERS`, no PR template, no `dependabot.yml`, no custom `action.yml`, no other CI providers.

### 2. Existing Code Review Agent

The local review agent is complete and functional:

| File                       | Purpose                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `scripts/review.ts`        | Entry point: reads diff from stdin, calls `Agent.prompt()`, validates JSON, exits 0/1 |
| `scripts/review/schema.ts` | Zod schema: 5 numeric criteria (1–10) + `verdict` (pass/fail) + `summary` (Markdown)  |
| `scripts/review/prompt.ts` | System prompt: instructs JSON-only output matching schema shape                       |
| `sandbox.json`             | Constrains Cursor agent to `workspace_readonly`                                       |

**Architecture**: thin entry point delegates to reusable pieces in `scripts/review/`. The stdin→JSON→exit-code pattern maps directly to what a composite GHA action needs.

**Reusable for CI/CD**:

- `scripts/review/schema.ts` — base shape is solid; needs extension (add `documentation` criterion)
- `scripts/review/prompt.ts` — needs expansion (PR title/description inputs, 6th criterion, stack-specific rubrics)
- `extractJson()` helper in `review.ts:16-19` — strips markdown fences, useful for any LLM without structured output

**Gaps for CI/CD**:

- No PR title/description handling
- Missing 6th criterion: `documentation`
- No stack-specific rubrics in prompt (requirements.md has detailed ones)
- No PR comment posting, label management, or retry logic
- Model `composer-2.5` is Cursor-specific; CI may need different provider/model

### 3. Project Toolchain

| Component       | Value                                                                                 |
| --------------- | ------------------------------------------------------------------------------------- |
| Node            | 22.14.0 (`.nvmrc`)                                                                    |
| Package manager | npm (`package-lock.json`)                                                             |
| Module type     | ESM (`"type": "module"`)                                                              |
| Test (unit)     | `vitest run` + `vitest run --config vitest.workers.config.ts`                         |
| Test (CI)       | `npm run test:ci` (same but without `--passWithNoTests`)                              |
| Test (E2E)      | `playwright test`                                                                     |
| Lint            | `eslint .` (flat config, TypeScript strict, Astro/React/a11y plugins)                 |
| Format          | `prettier --write .` (astro + tailwind plugins)                                       |
| Typecheck       | `astro check`                                                                         |
| Build           | `astro build`                                                                         |
| Pre-commit      | Husky → lint-staged (eslint fix on `*.{ts,tsx,astro}`, prettier on `*.{json,css,md}`) |
| Deploy          | Cloudflare Wrangler (`wrangler.jsonc`, `energy-monitor`)                              |

**CI-relevant commands** (what the existing `ci.yml` runs):

```bash
npm ci
npx astro sync
npm run test:ci
npm run lint
npm run build
```

**Secrets needed for build**: `SUPABASE_URL`, `SUPABASE_KEY` (as build-time env vars).

### 4. GitHub API & Label Integration

**Nothing exists yet** — no `gh` CLI usage in any scripts, no label config file, no PR comment automation.

**What needs to be built**:

1. **Labels** — `ai-cr:passed` (green `#0E8A16`), `ai-cr:failed` (red `#D93F0B`), `ai-cr:review` (trigger). Create once via `gh label create --force` (idempotent).

2. **PR comment** — `gh pr comment $PR_NUMBER --body "$SUMMARY"` with a cleanup marker (`<!-- ai-cr:marker -->`) to replace prior bot comments on re-run.

3. **Label management** — on verdict:
   - `pass`: `gh pr edit $PR_NUMBER --add-label "ai-cr:passed" --remove-label "ai-cr:failed"`
   - `fail`: `gh pr edit $PR_NUMBER --add-label "ai-cr:failed" --remove-label "ai-cr:passed"`

4. **Retry trigger** — workflow triggers on `labeled` event; guard step checks if label is `ai-cr:review`, removes it after processing, then runs review.

5. **Anti-loop guard** — skip re-runs triggered by the bot's own label changes. Pattern from `10x-impl-review-ci` template: check commit author and `[skip ci]` marker.

### 5. Patterns from `10x-impl-review-ci` Template

The lesson's `workflow-template.yml` demonstrates production patterns directly applicable:

| Pattern                                                       | Applicability                                |
| ------------------------------------------------------------- | -------------------------------------------- |
| Label-gated trigger (`contains(labels.*.name, ...)`)          | Use for `ai-cr:review` retry                 |
| Fork PR blocking (`head.repo.full_name == github.repository`) | Same — fork PRs can't use secrets            |
| Concurrency group (`cancel-in-progress: true`)                | Same — cancel stale runs on new push         |
| Bot commit skip guard                                         | Simpler version needed for label-only events |
| `gh pr comment` with HTML marker                              | Same pattern for cleanup                     |
| Prior comment cleanup via `gh api`                            | Same pattern                                 |

## Code References

- `scripts/review.ts` — entry point, stdin diff reader, JSON extraction, Zod validation
- `scripts/review/schema.ts` — `ReviewSchema` Zod definition (5 criteria + verdict + summary)
- `scripts/review/prompt.ts` — `REVIEW_SYSTEM_PROMPT` constant
- `.github/workflows/ci.yml` — existing CI pipeline (setup pattern to reuse)
- `.github/workflows/playwright.yml` — manual E2E workflow
- `sandbox.json` — Cursor agent read-only constraint
- `.nvmrc` — Node 22.14.0
- `wrangler.jsonc` — Cloudflare deployment config

## Architecture Insights

1. **Composite action is the right call.** The existing `ci.yml` already has checkout + Node setup + `npm ci`. A composite action under `.github/actions/code-review/` keeps the review logic reusable and the main workflow clean. The action receives diff, PR metadata, and API key via `inputs`, runs the review script, and handles side-effects (comment, labels).

2. **Extend, don't fork the schema.** `scripts/review/schema.ts` should gain the 6th `documentation` criterion directly — no reason to maintain two schemas. The prompt update follows the same file.

3. **`gh` CLI is the simplest path for side-effects.** No need for `@octokit/rest` or raw API calls — `gh pr comment`, `gh pr edit --add-label/--remove-label`, and `gh api` cover all requirements. The CLI is pre-installed on `ubuntu-latest` runners.

4. **Workflow trigger design:**
   - `pull_request: [opened, synchronize, reopened]` for automatic review
   - `pull_request: [labeled]` for retry via `ai-cr:review`
   - Guard: on `labeled` event, only proceed if label name is `ai-cr:review`, then remove it
   - Concurrency group per PR number with `cancel-in-progress: true`

5. **Cost-conscious diff strategy.** `fetch-depth: 0` + `git diff origin/$BASE...HEAD` (three-dot merge-base diff) is the correct approach. `fetch-depth: 2` would miss multi-commit PRs.

## Historical Context

- `context/changes/code-review-agent/` — prior change that built the local review agent (M5L2). Plan covers `@cursor/sdk` integration, schema design, and the `scripts/review/` structure. All phases complete.
- No prior CI/CD code review work exists in the repo — this is the first attempt.

## Open Questions

1. **API key for CI** — the local agent uses `CURSOR_API_KEY` with `@cursor/sdk`. Will CI use the same provider, or switch to Anthropic API / OpenRouter? This affects which secret to configure and which SDK to use in the composite action.
2. **Model selection** — `composer-2.5` is Cursor-specific. CI may benefit from a model with native structured output (e.g., Claude with tool use) to eliminate the `extractJson()` workaround.
3. **Cost tradeoff on PR description** — requirements mark PR description with `(?? cost tradeoff)`. Including it adds context but increases token count per review. Decision: include by default, add a workflow input flag to disable?
4. **Diff size limit** — no cap on diff size currently. Large PRs (500+ lines) may hit token limits or produce low-quality reviews. Consider a size guard that skips or warns.
