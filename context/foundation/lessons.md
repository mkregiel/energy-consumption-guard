# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## In-app window sum: accept JS reduce for MVP, plan DB aggregate for follow-up

**Context:** src/lib/services/limit-consumption-preview.ts

**Problem:** Preview queries fetch all kwh_delta rows in the current window into memory and reduce them in TypeScript. For month windows with many readings this grows unbounded, transferring unnecessary data.

**Rule:** When summing a column over a bounded time range for a single meter, prefer a DB aggregate (PostgREST column aggregation or RPC) over fetching all rows client-side. If the JS-reduce approach is used intentionally (e.g., MVP, RLS constraints), add a comment naming the constraint and a follow-up slice.

**Applies to:** Any service that sums consumption readings for preview or reporting.

## Exporting from an Astro-virtual-module-importing file requires a matching Vitest shim

**Context:** vitest.config.ts, src/middleware.ts (auth-boundary-ci-gate, Phase 1)

**Problem:** `src/middleware.ts` imports `defineMiddleware` from `astro:middleware`, a virtual module only resolvable inside Astro's runtime. Before Phase 1, nothing under `src/lib/` imported `middleware.ts`, so Vitest never had to load it. Exporting `isPublicApiRoute` and importing it from a new test file caused the whole module — including its `astro:middleware` import — to load under Vitest for the first time, failing with "Cannot find package 'astro:middleware'".

**Rule:** Before exporting a symbol from a file for unit-test use, check whether that file imports any `astro:*` virtual modules. If so, add a matching shim to vitest.config.ts (mirroring the existing astro:env/server pattern) in the same change.

**Applies to:** Any change that exports a new symbol from a file under src/ for direct unit testing, where that file (or its import chain) touches astro:middleware, astro:env/server, astro:content, etc.
