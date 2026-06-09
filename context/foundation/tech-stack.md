---
starter_id: 10x-astro-starter
package_manager: npm
project_name: energy-monitor
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: true
---

## MCP Servers (configured in .mcp.json)

| Server | Package | Auth required | Purpose |
|---|---|---|---|
| `context7` | `@upstash/context7-mcp` | None | Up-to-date library docs lookup — resolve `use context7` in prompts |
| `supabase` | `@supabase/mcp-server-supabase` | `SUPABASE_ACCESS_TOKEN` env var | Manage Supabase projects, run queries, inspect schema |
| `cloudflare` | `@cloudflare/mcp-server-cloudflare` | `CLOUDFLARE_API_TOKEN` env var | Manage Workers, KV, D1, deploy config |
| `playwright-test` | built-in | None | E2E browser testing |

**Agent guidance:** When writing code that uses a library, add `use context7` to the prompt to get current docs. For Supabase/Cloudflare operations use the respective MCP tools instead of raw CLI calls when available.

## Why this stack

Solo, web-app, 3 tygodnie po godzinach i termin 2026-08-10 — potrzebny starter z logowaniem, bazą i sensownym deployem bez budowania fundamentów od zera. 10x-astro-starter (Astro + React + TypeScript + Supabase + Cloudflare) jest rekomendowanym domyślnym wyborem dla (web, js): spełnia cztery kryteria agent-friendly, ma first-class confidence w bootstrapperze. PRD wymaga auth (FR-001) i okresowego sprawdzania zużycia (FR-005) — auth i DB są w starterze; harmonogram/cron dla Tuya i emaili to warstwa aplikacyjna (worker/kolejka poza edge). Deploy: Cloudflare Pages; CI: GitHub Actions z auto-deploy po merge. Integracja Tuya/Smart Life nie jest częścią startera — dojdzie w implementacji MVP.
