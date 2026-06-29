# CI/CD Code Review Workflow Implementation Plan

## Overview

Promote the existing local code review agent (`scripts/review.ts` using `@cursor/sdk`) to a CI/CD step that runs automatically on every pull request to `master`. The agent gains a 6th review criterion (`documentation`), stack-specific rubrics, and PR metadata as input. A composite action handles side-effects: posting a PR comment with the review summary, managing `ai-cr:passed`/`ai-cr:failed` labels, and supporting on-demand retry via `ai-cr:review` label.

## Current State Analysis

The local review agent is complete and functional:

- `scripts/review.ts` — entry point: reads diff from stdin, calls `Agent.prompt()`, validates JSON via Zod, exits 0 (pass) or 1 (fail)
- `scripts/review/schema.ts` — `ReviewSchema` with 5 numeric criteria (1–10) + `verdict` (pass/fail) + `summary` (Markdown)
- `scripts/review/prompt.ts` — `REVIEW_SYSTEM_PROMPT` instructing JSON-only output
- `sandbox.json` — constrains Cursor agent to `workspace_readonly`

Two GHA workflows exist (`ci.yml` for CI/deploy, `playwright.yml` for manual E2E) establishing the Node 22 + npm setup pattern. No PR automation, labels, or `gh` CLI usage exists yet.

### Key Discoveries:

- `scripts/review/schema.ts:13-39` — schema has 5 criteria; requirements call for 6 (add `documentation`)
- `scripts/review/prompt.ts:8-31` — prompt has no PR metadata inputs and no stack-specific rubrics
- `scripts/review.ts:22-28` — stdin-only input; needs PR title/body injection
- `.github/workflows/ci.yml` — established pattern: `actions/checkout@v4` + `actions/setup-node@v4` with Node 22 + `npm ci`
- No `.github/actions/` directory exists — composite action is net-new
- No labels exist in the repo — `ai-cr:passed`, `ai-cr:failed`, `ai-cr:review` must be created

## Desired End State

Every PR to `master` automatically receives an AI code review. The review scores the diff on 6 criteria with stack-specific rubrics, posts a Markdown summary as a PR comment, and applies a green `ai-cr:passed` or red `ai-cr:failed` label. Team members can re-trigger the review by adding `ai-cr:review` label. The workflow is also manually triggerable via `workflow_dispatch` for testing.

Verification:

- Create a test PR with a known-good diff → expect `ai-cr:passed` label and a comment with all 6 scores
- Create a test PR with a known-bad diff (e.g., hardcoded secret) → expect `ai-cr:failed` label and a comment identifying the issue
- Add `ai-cr:review` label to an existing PR → expect the review to re-run and prior comment to be replaced

## What We're NOT Doing

- **Plan-based implementation review** — the `10x-impl-review-ci` skill compares implementation against a plan; this is a general code review against quality criteria
- **Blocking merge gate** — labels are informational; no branch protection rule changes in this plan
- **Business alignment / architectural fit criteria** — parked for later per requirements
- **Model switching** — keeping `@cursor/sdk` with `composer-2.5`; model comparison is a separate promptfoo task
- **Diff filtering** — no lockfile/config exclusion logic; all changed files go to the agent

## Implementation Approach

Three phases, each independently deployable:

1. **Extend the agent** — add the 6th criterion, stack-specific rubrics, and PR metadata to the schema and prompt. The entry script gains a new invocation mode for CI (env vars instead of stdin).
2. **Build the composite action** — `.github/actions/code-review/action.yml` encapsulates: compute diff, run the review script, post PR comment with cleanup marker, manage labels.
3. **Wire the workflow** — `.github/workflows/code-review.yml` handles triggers, guards, concurrency, and retry logic.

## Phase 1: Extend Schema, Prompt, and Entry Script

### Overview

Add the `documentation` criterion to the Zod schema and system prompt. Inject stack-specific rubrics from `requirements.md` into the prompt. Modify the entry script to accept PR metadata via environment variables (CI mode) alongside the existing stdin mode (local mode).

### Changes Required:

#### 1. Add `documentation` criterion to schema

**File**: `scripts/review/schema.ts`

**Intent**: Add a 6th numeric field `documentation` to `ReviewSchema`, scored 1–10, matching the same pattern as the existing 5 fields. This keeps the schema as the single source of truth for the review output shape.

**Contract**: New field `documentation: z.number().describe(...)` added to the `ReviewSchema` object between `securitySafety` and `verdict`.

#### 2. Expand system prompt with 6th criterion and stack-specific rubrics

**File**: `scripts/review/prompt.ts`

**Intent**: Update `REVIEW_SYSTEM_PROMPT` to: (a) add `documentation` as the 6th scored criterion, (b) inject stack-specific rubrics for all 6 criteria (from `requirements.md`), (c) accept PR title and description as additional context alongside the diff, (d) include the `documentation` field in the expected JSON shape.

**Contract**: The prompt string must list 6 numbered criteria (not 5), include a `## Stack-Specific Guidance` section with rubrics for Astro/Supabase/Cloudflare/React 19, and the JSON shape example must include `"documentation": <number 1-10>`. PR title and description are presented as `## PR Title` and `## PR Description` sections before the diff.

#### 3. Add CI invocation mode to entry script

**File**: `scripts/review.ts`

**Intent**: Support two invocation modes: (a) existing stdin mode for local use (`git diff | npm run review`), (b) CI mode where diff, PR title, and PR description come from environment variables (`REVIEW_DIFF`, `REVIEW_PR_TITLE`, `REVIEW_PR_BODY`). CI mode also emits the full JSON result to `$GITHUB_OUTPUT` (key: `result`) so the composite action can read scores and verdict.

**Contract**: When `REVIEW_DIFF` env var is set, the script uses it instead of stdin. `REVIEW_PR_TITLE` and `REVIEW_PR_BODY` are optional — when present, they're prepended to the diff in the prompt. When `GITHUB_OUTPUT` env var exists, the script appends `result=<json>` to that file. The existing stdin + stdout + exit-code behavior is preserved when `REVIEW_DIFF` is not set.

#### 4. Add diff size warning

**File**: `scripts/review.ts`

**Intent**: When the diff exceeds 500 lines, log a warning to stderr. The warning is informational — the review still runs. The composite action (Phase 2) will include this warning in the PR comment.

**Contract**: Count newlines in the diff string. If > 500, write `WARNING: Large diff (N lines) — review quality may be reduced` to stderr. Set `REVIEW_LARGE_DIFF=true` in `$GITHUB_OUTPUT` if available.

### Success Criteria:

#### Automated Verification:

- Existing unit tests still pass: `npm run test:unit`
- Type checking passes: `npm run typecheck`
- Lint passes: `npm run lint`
- Local mode still works: `git diff HEAD~1 | CURSOR_API_KEY=$KEY npx tsx scripts/review.ts`

#### Manual Verification:

- CI mode works: `REVIEW_DIFF="..." CURSOR_API_KEY=$KEY npx tsx scripts/review.ts` produces valid JSON with all 6 criteria
- Output JSON includes `documentation` field with a score 1–10
- Summary mentions stack-specific observations when relevant

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Create Composite Action

### Overview

Build a local composite action at `.github/actions/code-review/action.yml` that encapsulates the full review flow: compute the diff, run the review script, post a PR comment with the summary, and manage labels. The action is self-contained — the workflow in Phase 3 simply calls it with inputs.

### Changes Required:

#### 1. Create composite action definition

**File**: `.github/actions/code-review/action.yml`

**Intent**: Define a composite action with `using: composite` that receives API key, PR number, PR title, PR body, and base ref as inputs. It computes the git diff, runs `scripts/review.ts` in CI mode, and outputs the verdict and full JSON result for the workflow to consume.

**Contract**:

- `inputs`: `api-key` (required), `pr-number` (required), `pr-title` (required), `pr-body` (optional), `base-ref` (required)
- `outputs`: `verdict` (pass/fail), `result` (full JSON string)
- Steps: (1) compute diff via `git diff origin/${{ inputs.base-ref }}...HEAD`, (2) run review script with env vars, (3) post PR comment, (4) manage labels, (5) handle retry label cleanup
- Every `run:` step must specify `shell: bash` (composite action requirement)

#### 2. PR comment posting with marker cleanup

**File**: `.github/actions/code-review/action.yml` (step within the action)

**Intent**: Post a Markdown comment to the PR with the review summary, scores table, and verdict. Use an HTML marker (`<!-- ai-cr:marker -->`) at the end of the comment body. Before posting, delete any prior bot comments with the same marker to prevent accumulation across re-runs.

**Contract**: Use `gh api` to list existing PR comments, filter by marker, delete matches, then `gh pr comment $PR_NUMBER --body "..."`. The comment body includes: verdict emoji, 6 criteria with scores, summary text, and a large-diff warning if applicable. The marker is always the last line.

#### 3. Label management

**File**: `.github/actions/code-review/action.yml` (step within the action)

**Intent**: Apply `ai-cr:passed` (green) or `ai-cr:failed` (red) label based on verdict, removing the opposite label if present. Create labels idempotently if they don't exist yet (first-run bootstrap).

**Contract**:

- `gh label create "ai-cr:passed" --color 0E8A16 --force` and `gh label create "ai-cr:failed" --color D93F0B --force` (idempotent)
- On pass: `gh pr edit $PR_NUMBER --add-label "ai-cr:passed" --remove-label "ai-cr:failed"`
- On fail: `gh pr edit $PR_NUMBER --add-label "ai-cr:failed" --remove-label "ai-cr:passed"`
- Suppress `--remove-label` errors (label might not be present)

### Success Criteria:

#### Automated Verification:

- Action YAML is valid: `actionlint .github/actions/code-review/action.yml` (or manual review)
- `gh label create --force` is idempotent: running it twice produces no error

#### Manual Verification:

- On a test PR, the action posts a well-formatted comment with all 6 scores and verdict
- The correct label (`ai-cr:passed` or `ai-cr:failed`) is applied
- Re-running replaces the old comment (marker cleanup works)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Create Workflow

### Overview

Wire the composite action into a new workflow file that handles all trigger types (PR events, retry label, manual dispatch), guards against loops and fork PRs, and manages concurrency.

### Changes Required:

#### 1. Create workflow file

**File**: `.github/workflows/code-review.yml`

**Intent**: Define a workflow triggered by `pull_request` (opened, synchronize, reopened), `pull_request` (labeled — for retry), and `workflow_dispatch` (for manual testing). The workflow calls the composite action from Phase 2 with the correct inputs and secrets.

**Contract**:

```yaml
name: AI Code Review
on:
  pull_request:
    branches: [master]
    types: [opened, synchronize, reopened, labeled]
  workflow_dispatch:
permissions:
  contents: read
  pull-requests: write
```

#### 2. Add guard steps

**File**: `.github/workflows/code-review.yml` (steps within the job)

**Intent**: Prevent unnecessary or dangerous runs: (a) skip fork PRs (can't use secrets), (b) on `labeled` events, only proceed if the label is `ai-cr:review` — skip for other labels, (c) on `workflow_dispatch` without a PR context, exit cleanly with a message.

**Contract**:

- Job-level `if`: `github.event.pull_request.head.repo.full_name == github.repository || github.event_name == 'workflow_dispatch'`
- Guard step: on `labeled` event, check `github.event.label.name == 'ai-cr:review'`; if not, skip remaining steps
- Guard step: on `workflow_dispatch`, check if PR context exists; if not, echo "Manual run without PR context — skipping" and exit 0

#### 3. Add concurrency and retry label cleanup

**File**: `.github/workflows/code-review.yml` (job-level config + step)

**Intent**: Cancel in-progress reviews when a new push arrives (same PR). After a retry triggered by `ai-cr:review`, remove the label so it can be re-added for future retries.

**Contract**:

- `concurrency: { group: "code-review-${{ github.event.pull_request.number }}", cancel-in-progress: true }`
- Post-review step: if trigger was `labeled` and label is `ai-cr:review`, run `gh pr edit $PR_NUMBER --remove-label "ai-cr:review"`

#### 4. Wire the composite action

**File**: `.github/workflows/code-review.yml` (main step)

**Intent**: Call the composite action with PR metadata from the event payload and the `CURSOR_API_KEY` secret.

**Contract**:

```yaml
- uses: ./.github/actions/code-review
  with:
    api-key: ${{ secrets.CURSOR_API_KEY }}
    pr-number: ${{ github.event.pull_request.number }}
    pr-title: ${{ github.event.pull_request.title }}
    pr-body: ${{ github.event.pull_request.body }}
    base-ref: ${{ github.event.pull_request.base.ref }}
  env:
    GH_TOKEN: ${{ github.token }}
```

### Success Criteria:

#### Automated Verification:

- Workflow YAML is valid: no syntax errors when pushed to GitHub
- Lint passes: `npm run lint` (no regressions)

#### Manual Verification:

- Push a test branch and open a PR to master → workflow triggers, review comment appears, label applied
- Push a new commit to the same PR → prior review comment is replaced, label updated
- Add `ai-cr:review` label → review re-runs, label is auto-removed after completion
- Fork PR does not trigger the workflow (or fails gracefully)
- Manual `workflow_dispatch` without PR context exits cleanly

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- No new unit tests needed — the schema extension is validated by the existing `safeParse` pattern
- Existing tests must continue to pass (regression gate)

### Integration Tests:

- Run the review script in CI mode with a known diff and verify JSON output matches the 6-criterion schema
- Verify `$GITHUB_OUTPUT` file contains `result=<json>` and `verdict=<pass|fail>`

### Manual Testing Steps:

1. Create a PR with a clean, small diff → expect `ai-cr:passed` label and positive scores
2. Create a PR with a deliberate security flaw (e.g., hardcoded API key) → expect `ai-cr:failed` and low `securitySafety` score
3. Create a PR with >500 lines changed → expect large-diff warning in the comment
4. Add `ai-cr:review` label → verify re-run and label removal
5. Push a second commit to a reviewed PR → verify old comment is replaced

## Performance Considerations

- Each review invocation calls the Cursor API once — cost is ~$0.01-0.05 per review depending on diff size
- Large diffs (500+ lines) get a warning but still run — monitor token usage via Cursor dashboard
- Concurrency group with `cancel-in-progress: true` prevents parallel runs on the same PR

## References

- Related research: `context/changes/ci-cd-code-review/research.md`
- Requirements: `context/changes/ci-cd-code-review/requirements.md`
- Existing review agent: `scripts/review.ts`, `scripts/review/schema.ts`, `scripts/review/prompt.ts`
- Existing CI workflow: `.github/workflows/ci.yml`
- Lesson template: `10x-impl-review-ci/references/workflow-template.yml` (patterns for guards, markers, label gating)

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Extend Schema, Prompt, and Entry Script

#### Automated

- [x] 1.1 Existing unit tests still pass: `npm run test:unit` — 0c66450
- [x] 1.2 Type checking passes: `npm run typecheck` — 0c66450
- [x] 1.3 Lint passes: `npm run lint` — 0c66450
- [x] 1.4 Local mode still works: `git diff HEAD~1 | CURSOR_API_KEY=$KEY npx tsx scripts/review.ts` — 0c66450

#### Manual

- [x] 1.5 CI mode produces valid JSON with all 6 criteria — 0c66450
- [x] 1.6 Summary mentions stack-specific observations when relevant — 0c66450

### Phase 2: Create Composite Action

#### Automated

- [x] 2.1 Action YAML is valid
- [x] 2.2 `gh label create --force` is idempotent

#### Manual

- [x] 2.3 Action posts well-formatted comment with all 6 scores and verdict
- [x] 2.4 Correct label applied based on verdict
- [x] 2.5 Re-running replaces old comment (marker cleanup)

### Phase 3: Create Workflow

#### Automated

- [ ] 3.1 Workflow YAML has no syntax errors
- [ ] 3.2 Lint passes: `npm run lint`

#### Manual

- [ ] 3.3 PR to master triggers workflow and produces review comment + label
- [ ] 3.4 New commit replaces prior comment and updates label
- [ ] 3.5 ai-cr:review label triggers re-run and is auto-removed
- [ ] 3.6 Fork PR does not trigger or fails gracefully
- [ ] 3.7 Manual workflow_dispatch exits cleanly without PR context
