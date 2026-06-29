# CI/CD Code Review Workflow — Plan Brief

> Full plan: `context/changes/ci-cd-code-review/plan.md`
> Research: `context/changes/ci-cd-code-review/research.md`

## What & Why

Promote the existing local code review agent (`scripts/review.ts`) to a CI/CD step that runs automatically on every PR to `master`. The agent gains a 6th review criterion, stack-specific rubrics, and PR metadata as input. Side-effects (PR comment, labels, retry) make the review visible in the team's workflow — not just an exit code on someone's laptop.

## Starting Point

A working local agent using `@cursor/sdk` with 5 criteria scored 1–10, a Zod-validated schema, and a clean stdin→JSON→exit-code pattern. Two GHA workflows exist (`ci.yml`, `playwright.yml`) establishing the Node 22 + npm setup pattern. No PR automation, labels, or composite actions exist yet.

## Desired End State

Every PR to `master` automatically receives an AI review comment with 6 scored criteria, a pass/fail verdict, and a green/red label. Team members can re-trigger reviews via the `ai-cr:review` label. The workflow is also manually triggerable for testing.

## Key Decisions Made

| Decision                | Choice                           | Why (1 sentence)                                                                   | Source   |
| ----------------------- | -------------------------------- | ---------------------------------------------------------------------------------- | -------- |
| LLM provider            | Keep `@cursor/sdk`               | Zero code changes to review logic — just wire existing script into GHA             | Plan     |
| PR description as input | Include by default               | Agent needs full context to judge code-vs-intent alignment                         | Plan     |
| Large diff handling     | Warn but review                  | No PR goes unreviewed; warning sets quality expectations                           | Plan     |
| Retry label behavior    | Auto-remove after run            | User can re-add to trigger another retry — idempotent                              | Plan     |
| Manual trigger          | Add `workflow_dispatch`          | Easy testing without creating a real PR; matches existing `playwright.yml` pattern | Plan     |
| Action architecture     | Local composite action           | Clean separation; main workflow stays ~30 lines; reusable across repos later       | Plan     |
| Review criteria         | 6 criteria (add `documentation`) | Requirements specify it; stack-specific rubrics ground each criterion              | Research |

## Scope

**In scope:**

- Extend schema with 6th criterion (`documentation`) and stack-specific rubrics
- CI invocation mode for the review script (env vars instead of stdin)
- Diff size warning (>500 lines)
- Composite action with PR comment (marker cleanup), label management
- Workflow with PR triggers, `labeled` retry, `workflow_dispatch`, concurrency, guards

**Out of scope:**

- Plan-based implementation review (separate `10x-impl-review-ci` skill)
- Merge-blocking branch protection rules
- Business alignment / architectural fit criteria
- Model switching or promptfoo comparison
- Diff filtering (lockfiles, configs)

## Architecture / Approach

Three-layer separation: the **review script** (`scripts/review.ts`) handles LLM interaction and validation; the **composite action** (`.github/actions/code-review/action.yml`) handles diff computation and side-effects (comment, labels); the **workflow** (`.github/workflows/code-review.yml`) handles triggers, guards, and concurrency. Each layer is independently testable.

## Phases at a Glance

| Phase                      | What it delivers                                               | Key risk                                                           |
| -------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1. Extend Schema & Prompt  | 6-criterion schema, stack-specific rubrics, CI invocation mode | Prompt drift — JSON field names must stay in sync with schema      |
| 2. Create Composite Action | PR comment with marker cleanup, label management               | `gh` CLI edge cases on label removal when label doesn't exist      |
| 3. Create Workflow         | Trigger routing, guards, concurrency, retry                    | Anti-loop guard must prevent re-trigger on bot's own label changes |

**Prerequisites:** `CURSOR_API_KEY` secret must be added to GitHub repo settings before Phase 3 testing.
**Estimated effort:** ~2 sessions across 3 phases.

## Open Risks & Assumptions

- `@cursor/sdk` works on `ubuntu-latest` GHA runners (untested — first CI use)
- Cursor API rate limits may affect high-PR-volume days
- `composer-2.5` model may not be optimal for CI reviews — promptfoo comparison is a separate follow-up

## Success Criteria (Summary)

- Every PR to `master` gets an AI review comment with 6 scored criteria and a pass/fail verdict
- Correct label (`ai-cr:passed` or `ai-cr:failed`) is applied automatically
- Adding `ai-cr:review` label re-triggers the review and prior comment is replaced
