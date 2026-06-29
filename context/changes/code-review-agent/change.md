---
change_id: code-review-agent
title: Scripted code review agent on Cursor SDK (local, lesson 2 scope)
status: planned
created: 2026-06-29
updated: 2026-06-29
archived_at: null
---

## Notes

Introducing first scripted code review agent based on Cursor SDK, scoring a git diff against criteria and returning a structured JSON verdict (pass/fail). Local execution only for now (10xDevs M5L2 scope) — CI/CD integration via GitHub Actions comes later (M5L3).

Key constraints discovered during scoping:
- `@cursor/sdk` has no native structured-output / JSON-schema enforcement (unlike Claude Agent SDK or Vercel AI SDK). Must instruct the model to emit JSON and validate with zod (`safeParse`) ourselves.
- Auth via `CURSOR_API_KEY` env var, works with both user API keys and service-account API keys (the latter matters for the future CI step).
- API confirmed via Context7 docs (`Agent.prompt(message, options)` → `RunResult { status, result, durationMs, ... }`), not from memory.
- Goal for this change: one script, run as `git diff | npx tsx review.ts`, no CI wiring yet.
