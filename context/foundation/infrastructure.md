---
project: energy-monitor
researched_at: 2026-05-22
recommended_platform: Cloudflare Workers
runner_up: Vercel
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6 + React 19
  runtime: Cloudflare Workers (workerd) via @astrojs/cloudflare ^13.5
---

## Recommendation

**Deploy on Cloudflare Workers.**

The repository is already wired for this path: `output: "server"`, `@astrojs/cloudflare` ^13.5, `wrangler` ^4.90, and `wrangler.jsonc` with `nodejs_compat`. Interview answers fit the model — stateless request/response (no WebSockets), external Supabase is fine, single region is enough, and cost vs DX is neutral. Compared to Vercel or Netlify, Cloudflare wins on zero adapter migration, agent-friendly ops (`wrangler` CLI, `llms.txt`), and alignment with the 10x starter's `deployment_target: cloudflare-pages` (SSR now targets Workers, not legacy Pages-only flows). Plan for **Workers Paid (~$5/mo)** once SSR + cron traffic exceeds free-tier CPU limits.

## Platform Comparison

| Platform | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP / Integration | Total |
|---|---|---|---|---|---|---|
| Cloudflare | Pass | Pass | Pass | Pass | Pass | 5P |
| Netlify | Pass | Pass | Pass | Pass | Pass | 5P |
| Vercel | Pass | Pass | Pass | Pass | Partial (public beta) | 4P + 1Pa |
| Fly.io | Pass | Pass | Partial | Pass | Partial (experimental) | 3P + 2Pa |
| Railway | Pass | Pass | Partial | Pass | Partial (beta remote MCP) | 3P + 2Pa |
| Render | Partial | Pass | Partial | Partial | Pass (hosted MCP) | 2P + 3Pa |

**Hard filters applied:** No persistent connections required — no platform excluded. All six support TypeScript/Node-style Astro SSR with an appropriate adapter; only Cloudflare matches the adapter already in the repo.

**Soft weights from interview:** Single region (edge less critical); external Supabase OK (no colocation bonus for Railway/Render Postgres); hyperscaler experience noted — Cloudflare is simpler day-to-day than AWS/GCP for this MVP while still being new tooling; cost ≈ DX — Cloudflare free request quota is generous, but SSR CPU likely pushes to Paid tier (documented under risks).

### Cloudflare Workers

Full passes on all five agent-friendly criteria. `wrangler deploy`, `wrangler rollback`, `wrangler tail`, and gradual deployments (GA) cover the agent ops loop. Official `llms.txt` / `llms-full.txt` and MCP servers for Workers/docs/observability. Astro 6 SSR deploys as a Worker bundle (`dist/_worker.js` + static assets) per `@astrojs/cloudflare` v13+; Pages-only deploy is no longer the SSR path. Cron Triggers (GA) suit FR-005 periodic limit checks without always-on processes. Supabase stays external; optional Hyperdrive if direct Postgres is added later.

### Vercel

Strong Astro and agent docs (`llms.txt`, MDX on GitHub). Would require swapping to `@astrojs/vercel` and re-validating middleware/env. Hobby tier is not for commercial products; Pro is ~$20/seat/mo. Vercel MCP is public beta (May 2026). No native WebSockets on Functions — not a blocker for this PRD. Runner-up when team preference or marketplace integrations outweigh adapter lock-in.

### Netlify

Tied Cloudflare on criteria; official Netlify MCP Server (GA) and `llms.txt`. Requires `@astrojs/netlify` migration. Credit-based pricing (from April 2026) makes cost less predictable than Workers' request+CPU model for SSR. Edge middleware and streaming limits are Astro-specific gotchas. Third-place alternative for agent tooling parity.

### Fly.io

Containers with persistent processes and `flyctl` — overpowered for stateless MVP and mismatched with current Cloudflare adapter (would need `@astrojs/node`). No meaningful free tier; ~$5–70/mo at low traffic. Managed Postgres ($38+/mo) irrelevant with Supabase. MCP via `fly mcp` is experimental.

### Railway

Fast PaaS DX and optional colocated Postgres; Railpack builder is beta (March 2026). Requires `@astrojs/node` standalone migration. Cron minimum 5 minutes UTC. Remote MCP in public testing. Good if leaving edge model entirely — not needed here.

### Render

Mature PaaS with Blueprint/`render.yaml` and hosted MCP. Free web services sleep after 15 min (poor for alert MVP). Cron jobs not on free tier. Needs `@astrojs/node` migration. Bandwidth limits on new Hobby plan (5 GB/mo) matter at 10k–100k visits. Solid Node-host fallback, weakest fit vs existing repo wiring.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Wins because the starter, `tech-stack.md`, and `astro.config.mjs` already target it; five Pass scores; `wrangler` + GitHub Actions lint/build are in place; Cron Triggers cover background limit evaluation without persistent workers; Supabase external auth/DB is a documented pattern.

#### 2. Vercel

Second: best-known Astro hosting narrative and excellent agent docs. Gap: adapter swap, commercial Hobby restriction, MCP still beta, and no advantage over Cloudflare for a solo EU home-energy MVP with Supabase already chosen.

#### 3. Netlify

Third: equal criterion scores and GA MCP. Gap: adapter swap, newer credit pricing model, and no repo-level bootstrap alignment vs Cloudflare.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **Free-tier CPU (10 ms/invocation)** — SSR pages that call Supabase on every request exceed free CPU quickly; budget Workers Paid (~$5/mo minimum) for production.
2. **Pages vs Workers naming** — Tutorials still say "Cloudflare Pages"; `@astrojs/cloudflare` v13+ deploys SSR to **Workers** — easy to misconfigure docs or dashboards.
3. **Cron + Tuya latency** — Cron Triggers are short-lived isolates; slow Tuya API responses risk timeouts unless jobs are chunked or retried with idempotency.
4. **`nodejs_compat` gaps** — Tuya/community SDKs may assume full Node APIs unavailable on `workerd`; validate packages before committing to in-Worker integration.
5. **Rollback + fingerprinted assets** — Gradual deployments without version affinity can serve stale HTML pointing at missing JS chunks (404s after rollback).

### Pre-Mortem — How This Could Fail

The team shipped Astro on Cloudflare, connected Supabase, and added a Cron Trigger for Tuya polling. Early weeks looked fine on the free tier. After the first real user and daily alert emails, CPU billing spiked because every dashboard load ran SSR plus Supabase round-trips, and cron jobs started timing out when Tuya responded slowly. The team assumed serverless meant "no capacity planning." Mid-MVP migration to Vercel or Railway cost a week: new adapter, env binding changes, and retesting Supabase SSR cookies. A rollback after a bad deploy broke styling for some users because static asset hashes and active Worker versions diverged. The platform choice was defensible; the failure was underestimating **SSR CPU + scheduled integration work**, not picking edge hosting per se.

### Unknown Unknowns

- **`npm run dev` (Astro 6 + `@astrojs/cloudflare` v13+)** runs against real `workerd` via the Cloudflare Vite plugin — separate `wrangler dev` is often redundant for local fidelity.
- **Hyperdrive** helps pooled Postgres connections; with `@supabase/supabase-js` over HTTPS it may never be needed in MVP.
- **Secrets model** differs from AWS: production secrets are `wrangler secret put` / dashboard, not Parameter Store; GitHub repo secrets are only for CI build validation today (see `ci.yml`).
- **Background work** is Cron Trigger invocations, not a daemon — design FR-005 as idempotent, short HTTP/cron handlers.
- **Workers Paid** is the realistic production floor for SSR, not the 100k requests/day free headline alone.

## Operational Story

- **Preview deploys**: Not configured in repo yet. Typical path: connect GitHub to Cloudflare Workers, enable preview deployments per PR (branch aliases). Protect preview URLs if exposing real Supabase/Tuya test credentials (e.g. Cloudflare Access or separate Supabase project). Fork PR previews may be disabled by default — confirm in account settings before relying on them.
- **Secrets**: Runtime: Cloudflare dashboard → Workers → Settings → Variables/Secrets, or `npx wrangler secret put SUPABASE_URL` / `SUPABASE_KEY`. CI build: GitHub repository secrets `SUPABASE_URL`, `SUPABASE_KEY` (already referenced in `.github/workflows/ci.yml`). Rotation: update in Cloudflare, redeploy; update GitHub secrets for CI; never commit `.env` to git.
- **Rollback**: `npx wrangler rollback [VERSION_ID]` for emergency revert; or gradual traffic shift via `npx wrangler versions deploy` (GA). Time-to-revert: minutes. Database migrations (Supabase) do not roll back with Worker rollback — handle schema separately.
- **Approval**: Human should approve production deploys that change secrets, Tuya production credentials, or Supabase RLS/migrations. Agent-safe unattended: `npm run lint`, `npm run build`, read-only `wrangler tail`, dry-run builds in CI.
- **Logs**: Runtime: `npx wrangler tail` (live) or Cloudflare dashboard Observability (enabled in `wrangler.jsonc`). CI: `gh run view` / GitHub Actions log UI. MCP: Cloudflare observability MCP servers for structured queries when configured.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Free-tier CPU exceeded by SSR + Supabase | Devil's advocate / Research | High | Medium | Enable Workers Paid early; monitor CPU ms in dashboard; cache read-heavy dashboard data where safe |
| Tuya SDK or HTTP client incompatible with `workerd` | Devil's advocate / Unknown unknowns | Medium | High | Spike Tuya call in Worker locally via `npm run dev`; fallback to external cron (GitHub Actions) hitting API route if package fails |
| Cron job timeout on slow Tuya API | Devil's advocate / Pre-mortem | Medium | High | Keep cron handler short; store last reading in Supabase; retry with idempotency; alert on job failure |
| Rollback causes 404 on static assets | Devil's advocate | Low | Medium | Use version affinity for gradual rollouts; prefer instant rollback only for Worker logic, not asset fingerprint mismatches |
| Confusion Pages vs Workers deploy target | Unknown unknowns / Research | Medium | Low | Follow README deploy section; use `npx wrangler deploy` after `npm run build`; ignore legacy Pages-only guides for SSR |
| Underestimating FR-005 background work | Pre-mortem | Medium | High | Design Cron Trigger + API route contract before Tuya integration; log job outcomes to Supabase table |

## Getting Started

1. **Cloudflare account & login** — Install/login Wrangler (already in devDependencies): `npx wrangler login`.
2. **Configure Worker name** — Edit `name` in `wrangler.jsonc` if you need a project-specific Worker id (default: `10x-astro-starter`).
3. **Set production secrets** — `npx wrangler secret put SUPABASE_URL` and `npx wrangler secret put SUPABASE_KEY` (service role or appropriate server key per security review).
4. **Build and deploy** — `npm run build` then `npx wrangler deploy` (matches README; adapter emits Worker + assets to `dist/`).
5. **Add deploy to CI (optional next step)** — Extend `.github/workflows/ci.yml` with a deploy job using `CLOUDFLARE_API_TOKEN` and account id after merge to `master`; keep secrets in GitHub for build, Cloudflare for runtime.

For FR-005 cron (after API exists): add a `triggers.crons` entry in `wrangler.jsonc` and a dedicated API route handler — validate schedule in UTC.

## Out of Scope

The following were not evaluated in this research:

- Docker image configuration
- CI/CD pipeline setup beyond noting existing GitHub Actions lint/build
- Production-scale architecture (multi-region HA, DR, dedicated support tiers)
