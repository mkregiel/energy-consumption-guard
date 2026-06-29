# Scripted Code Review Agent (Cursor SDK) Implementation Plan

## Overview

We are building a minimal, scripted code review agent for local use: `git diff | npx tsx scripts/review.ts`. The agent is built on `@cursor/sdk`'s `Agent.prompt()`, scores a git diff on five criteria (1-10), produces a binding pass/fail verdict, and returns a Markdown summary — all as a single JSON object validated against a shared zod schema. No CI/CD wiring in this change; that is a separate, future change (10xDevs M5L3 scope).

## Current State Analysis

The repo has no code-review tooling today. It is a standard Astro + Cloudflare Workers starter (`10x-astro-starter`) with:

- `tsx` already present as a devDependency (used by `scripts/seed-test-breach.ts` via the same `npx tsx scripts/...ts` invocation pattern we'll follow).
- `zod` `^4.4.3` in `dependencies`.
- No `scripts/review/` directory yet; `scripts/` currently holds a single flat script (`seed-test-breach.ts`) plus a `.ps1` helper.
- `.env.example` documents required env vars with one-line comments above each `KEY=###` placeholder — we'll follow that convention for `CURSOR_API_KEY` and `CURSOR_REVIEW_MODEL`.
- `tsconfig.json` extends `astro/tsconfigs/strict` and includes `**/*`, so `scripts/**` is already type-checked by `astro check` / `tsc --noEmit`.

### Key Discoveries:

- `@cursor/sdk` (confirmed via Context7 docs, not memory) exposes `Agent.prompt(message, options)` → `Promise<RunResult>` where `RunResult = { id, requestId?, status: "finished"|"error"|"cancelled", result?: string, model?, durationMs?, git? }`. There is **no native JSON-schema/structured-output enforcement** — `result` is plain assistant text. We must instruct the model via prompt to emit *only* a JSON object and validate it ourselves with `zod.safeParse`.
- Auth: `CURSOR_API_KEY` env var or `apiKey` option; both user API keys and service-account API keys are accepted for local and cloud runs (this matters for the future CI change, M5L3, which is explicitly out of scope here).
- `local: { cwd, sandboxOptions: { enabled: boolean } }` controls filesystem access for a local agent. `sandboxOptions.enabled: true` activates the sandbox; a `sandbox.json` at the workspace root with `"type": "workspace_readonly"` further restricts the agent to read-only filesystem access within the workspace (per `cursor.com/docs/reference/sandbox`). This is how we honor the decision to give the agent repo access for context while keeping it from mutating files.
- `@cursor/sdk`'s own `package.json` depends on `zod: ^3.25.0`, but this is a regular (nested) dependency, not a peer dependency — it does not conflict with the repo's `zod ^4.4.3`, since each package resolves its own nested copy under `node_modules`. No real conflict; flagging is complete, no action needed beyond a quick `npm ls zod` sanity check after install.

## Desired End State

Running `git diff | npx tsx scripts/review.ts` (or `npm run review` piped the same way) from repo root:

1. Reads the diff from stdin.
2. Sends it to a Cursor agent (`Agent.prompt`) with repo read-only access (`local.cwd` + sandboxed `workspace_readonly`), using the model from `CURSOR_REVIEW_MODEL` (default `composer-2.5`).
3. Parses the agent's text response as JSON and validates it against `REVIEW_SCHEMA` (zod).
4. On success, prints the validated JSON review object to stdout (pretty-printed) and exits 0 if `verdict === "pass"`, exits 1 if `verdict === "fail"`.
5. On any failure (non-"finished" status, malformed JSON, schema mismatch), prints a clear error to stderr and exits 1 — never silently emits a fabricated "fail" verdict for an infrastructure problem.

### Key Discoveries:

(see Current State Analysis above — consolidated there since this is a small, single-pass change)

## What We're NOT Doing

- No GitHub Actions / CI integration (separate future change, M5L3 scope).
- No PR title/body input — diff only, per lesson 2 scope.
- No composite action, no PR comments, no labels.
- No promptfoo evals or multi-model comparison (future change).
- No write access for the agent — read-only sandbox is mandatory, not optional.
- No retry/backoff logic for transient Cursor API failures — first version fails fast.

## Implementation Approach

Mirror the lesson's pattern (shared schema/prompt module + thin entry script) but adapted to Cursor SDK's lack of structured-output support: the schema module is reused for *validation* (not for `outputFormat`/`Output.object` like Claude Agent SDK / Vercel AI SDK), and the prompt module is responsible for getting the model to emit clean, parseable JSON.

## Critical Implementation Details

**JSON extraction from `result.result`.** Even with strict prompt instructions, models often wrap JSON in markdown code fences (` ```json ... ``` `) or add a leading/trailing sentence. The parsing step must strip a leading/trailing ` ```json` / ` ``` ` fence (if present) before `JSON.parse`, and should fail with a clear error (showing the raw text, truncated) rather than letting `JSON.parse` throw an opaque `SyntaxError`.

**Sandbox read-only enforcement.** `sandboxOptions: { enabled: true }` alone does not guarantee read-only — it activates the sandbox using whatever `sandbox.json` exists (or defaults, which may be read-write within the workspace). We must ship a `sandbox.json` at repo root with `"type": "workspace_readonly"` for the read-only guarantee to actually hold, and additionally state "do not modify any files" in the system prompt as a defense-in-depth instruction (belt-and-suspenders, since prompt instructions alone are not a security boundary).

## Phase 1: Shared schema and prompt module

### Overview

Establish the reusable building blocks — the zod schema for the review output and the system prompt text — in their own modules so a future CI integration (M5L3) can import them without touching the Cursor-specific entry script.

### Changes Required:

#### 1. Review schema module

**File**: `scripts/review/schema.ts`

**Intent**: Define the single source of truth for the review output shape: five 1-10 criteria (implementation correctness, idiomaticity, complexity, test coverage relative to risk, security), a binding `verdict: "pass" | "fail"`, and a `summary` string (Markdown, PR-comment-ready). Export both the zod schema and the inferred TypeScript type, mirroring the lesson's `REVIEW_SCHEMA` / `Review` pattern.

**Contract**: `z.object({ implementationCorrectness: z.number().describe(...), idiomaticity: ..., complexity: ..., testRiskCoverage: ..., securitySafety: ..., verdict: z.enum(["pass","fail"]).describe(...), summary: z.string().describe(...) })`. Each numeric field's `.describe()` must state the 1-10 scale explicitly (since Cursor SDK has no schema-level min/max enforcement at all — unlike even the Claude Agent SDK case in the lesson, we have *zero* structural validation of the score range, so the description carrying the scale is the only lever we have). Export `ReviewSchema` and `type Review = z.infer<typeof ReviewSchema>`.

#### 2. System prompt module

**File**: `scripts/review/prompt.ts`

**Intent**: Hold the system prompt text that instructs the model to act as a precise, constructive code reviewer, score the diff on the five criteria, and — critically, since Cursor SDK won't enforce a schema — return *only* a single JSON object with no prose, no markdown fences, no commentary, matching the exact field names from `schema.ts`. Must also instruct the agent not to modify any files (defense-in-depth alongside the read-only sandbox).

**Contract**: Export a single `REVIEW_SYSTEM_PROMPT: string` constant. The prompt text must enumerate the five criteria by name and the exact JSON field names/types so the model's free-text output lines up with `ReviewSchema`.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check` (or `npx tsc --noEmit`)
- Linting passes: `npm run lint`
- `scripts/review/schema.ts` exports compile and `ReviewSchema.parse({...validSample})` succeeds in a quick manual `node -e`/`tsx` smoke check (no formal unit test framework wiring required for this small change)

#### Manual Verification:

- Reading `prompt.ts` aloud confirms the five criteria names and JSON field names match `schema.ts` exactly (no drift between prose and schema)

---

## Phase 2: Cursor SDK integration and entry script

### Overview

Wire `Agent.prompt()` into a runnable entry script that reads stdin, calls the agent with a read-only sandboxed local workspace, extracts and validates JSON output, and sets the process exit code from the verdict.

### Changes Required:

#### 1. Add dependency

**File**: `package.json`

**Intent**: Add `@cursor/sdk` to `dependencies` (it's invoked at runtime by the script, not just at build time).

**Contract**: `"@cursor/sdk": "^1.0.22"` (or whatever the latest 1.x is at install time — use `npm install @cursor/sdk` rather than hand-pinning, then record the resolved version). After install, run `npm ls zod` once to confirm no peer-dependency conflict surfaces (expected: two independent `zod` resolutions, repo's own `^4.4.3` and `@cursor/sdk`'s nested `^3.25.0`).

#### 2. Sandbox config

**File**: `sandbox.json` (repo root)

**Intent**: Constrain the local Cursor agent to read-only filesystem access for the entire workspace, per the Critical Implementation Details note above.

**Contract**: `{ "type": "workspace_readonly" }` — minimal config, no extra read/write path overrides needed since the script only needs to read the existing repo for context.

#### 3. Entry script

**File**: `scripts/review.ts`

**Intent**: Read the diff from stdin, call `Agent.prompt()` with the shared prompt as the message (diff appended), `local: { cwd: process.cwd(), sandboxOptions: { enabled: true } }`, model from `CURSOR_REVIEW_MODEL` env var (default `"composer-2.5"`), and `apiKey: process.env.CURSOR_API_KEY`. On `status !== "finished"`, throw an `Error` including the status and any available `result` text, and let it propagate (process exits non-zero via the uncaught exception — no custom catch-and-exit(1) needed beyond what Node does by default, but add one explicit `try/catch` at the top level that logs via `console.error` before exiting 1, so the failure message is clean rather than a raw stack dump). On success, extract JSON from `result.result` (strip optional ` ```json`/` ``` ` fences), `JSON.parse` it, then `ReviewSchema.safeParse` it; on parse/validation failure, log the raw text (truncated to ~2000 chars) and the zod error, then exit 1. On schema success, `console.log(JSON.stringify(parsed.data, null, 2))` and `process.exit(parsed.data.verdict === "pass" ? 0 : 1)`.

**Contract**: Module reads `process.stdin` to completion before constructing the prompt (same stdin-reading pattern as the lesson's `readDiff()` — accumulate `Buffer` chunks via `for await (const chunk of process.stdin)`, concatenate, `.toString("utf8")`). No CLI argument parsing needed (diff is stdin-only, no `--file` flag, per lesson 2 scope).

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- `npm ls zod` shows no `npm error` about an unresolvable peer conflict (two independent `zod` versions resolved is expected and fine)

#### Manual Verification:

- With a valid `CURSOR_API_KEY` set, `git diff | npx tsx scripts/review.ts` against a small real diff in this repo (e.g. a trivial whitespace change) returns a JSON object on stdout matching `ReviewSchema`'s shape and exits 0 or 1 consistently with the printed `verdict`
- Forcing a Cursor API failure (e.g. temporarily unsetting `CURSOR_API_KEY`) produces a clear, single-line-ish error on stderr and exit code 1 — not a raw stack trace, not a fabricated "fail" verdict JSON
- Confirm (by inspecting agent behavior/output, or by attempting a deliberate "fix this typo" instruction smuggled into a test diff) that the agent does not modify any files under the read-only sandbox

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Wiring, docs, and end-to-end verification

### Overview

Make the script discoverable and runnable the way the rest of the repo's scripts are (`npm run <name>`), document the two new env vars, and do a final end-to-end pass against a real diff.

### Changes Required:

#### 1. npm script

**File**: `package.json`

**Intent**: Add a convenience script so the entry point matches the repo's existing `npx tsx scripts/...ts` convention surfaced via `npm run`.

**Contract**: Add `"review": "tsx scripts/review.ts"` to `"scripts"`. Usage becomes `git diff | npm run review --silent` (note `--silent` to suppress npm's own script-name echo polluting stdout JSON) or the direct `git diff | npx tsx scripts/review.ts` form documented in the script's own header comment.

#### 2. Env var documentation

**File**: `.env.example`

**Intent**: Document the two new env vars following the file's existing one-line-comment-above-`KEY=###` convention.

**Contract**: Add, near the bottom (own small section, e.g. after the Tuya block):
```
# Cursor API key for the code review agent (Cursor Dashboard → Settings → API Keys, or a Team service-account key)
# CURSOR_API_KEY=###
# Cursor Composer model id for code review (optional, defaults to composer-2.5)
# CURSOR_REVIEW_MODEL=composer-2.5
```

#### 3. Script header documentation

**File**: `scripts/review.ts`

**Intent**: A short header comment naming the two invocation forms and required env var, so a future reader doesn't need to reverse-engineer usage from the implementation.

**Contract**: Plain comment block, no code-behavior change — e.g. `// Usage: git diff | npx tsx scripts/review.ts` plus a one-line note that `CURSOR_API_KEY` is required and `CURSOR_REVIEW_MODEL` is optional.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npx astro check`
- Linting passes: `npm run lint`
- `npm run review --silent` (piped a sample diff) produces valid JSON on stdout with no extraneous npm output mixed in

#### Manual Verification:

- End-to-end run against a real, non-trivial diff from this repo's history (e.g. `git diff HEAD~1 HEAD -- src/`) produces a sensible, human-readable review (scores look plausible given the actual diff content, summary text is coherent and references the right kind of change)
- `.env.example` changes reviewed for consistency with the rest of the file's formatting/style

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- Not introducing a formal test suite for this script in this change — it's a small, manually-verified CLI tool, consistent with `scripts/seed-test-breach.ts` having no unit tests either. If reused later inside `packages/code-reviewer` for the CI change (M5L3), formal tests (including the schema and JSON-extraction logic) become worthwhile then.

### Integration Tests:

- None automated in this change — manual end-to-end runs against real diffs are the verification method (see Phase 2 and 3 Manual Verification).

### Manual Testing Steps:

1. Set `CURSOR_API_KEY` (and optionally `CURSOR_REVIEW_MODEL`) in `.env` or shell env.
2. Run `git diff | npx tsx scripts/review.ts` against an uncommitted small change.
3. Confirm JSON output matches `ReviewSchema`, exit code matches `verdict`.
4. Run again with `CURSOR_API_KEY` unset to confirm the error path (no fabricated pass/fail).
5. Run against a larger historical diff (`git diff HEAD~1 HEAD`) to sanity-check review quality and confirm no files were modified (`git status` clean after the run).

## Performance Considerations

None specific — single synchronous agent call per invocation, no loops, no batching. Cursor agent call latency (seconds) is acceptable for a manually-invoked local script.

## Migration Notes

Not applicable — net-new script, no existing data or behavior to migrate.

## References

- Lesson source: 10xDevs M5L2 ("Twój pierwszy Agent zespołowy: SDK, koszty, metryki") and M5L3 ("Code Review w erze AI") — this change implements the M5L2 local-script scope only.
- Cursor SDK API confirmed via Context7 docs (`cursor.com/docs/sdk/typescript`, `cursor.com/docs/reference/sandbox`, `cursor.com/docs/evals`), not from memory.
- Existing script convention: `scripts/seed-test-breach.ts` (stdin-free but same `npx tsx scripts/*.ts` invocation style).

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Shared schema and prompt module

#### Automated

- [x] 1.1 Type checking passes: `npx astro check` — 8493cc1
- [x] 1.2 Linting passes: `npm run lint` — 8493cc1
- [x] 1.3 `ReviewSchema.parse({...validSample})` succeeds in a quick smoke check — 8493cc1

#### Manual

- [x] 1.4 Prose in `prompt.ts` matches `schema.ts` field names/criteria exactly — 8493cc1

### Phase 2: Cursor SDK integration and entry script

#### Automated

- [x] 2.1 Type checking passes: `npx astro check` — 3539fac
- [x] 2.2 Linting passes: `npm run lint` — 3539fac
- [x] 2.3 `npm ls zod` shows no unresolvable peer conflict — 3539fac

#### Manual

- [x] 2.4 Valid `CURSOR_API_KEY` run returns schema-matching JSON and consistent exit code — 3539fac
- [x] 2.5 Missing `CURSOR_API_KEY` run produces a clear error, not a fabricated verdict — 3539fac
- [x] 2.6 Agent does not modify any files under the read-only sandbox — 3539fac

### Phase 3: Wiring, docs, and end-to-end verification

#### Automated

- [x] 3.1 Type checking passes: `npx astro check`
- [x] 3.2 Linting passes: `npm run lint`
- [x] 3.3 `npm run review --silent` produces clean JSON on stdout

#### Manual

- [x] 3.4 End-to-end run against a real historical diff produces a sensible review
- [x] 3.5 `.env.example` formatting reviewed for consistency
