# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## In-app window sum: accept JS reduce for MVP, plan DB aggregate for follow-up

**Context:** src/lib/services/limit-consumption-preview.ts

**Problem:** Preview queries fetch all kwh_delta rows in the current window into memory and reduce them in TypeScript. For month windows with many readings this grows unbounded, transferring unnecessary data.

**Rule:** When summing a column over a bounded time range for a single meter, prefer a DB aggregate (PostgREST column aggregation or RPC) over fetching all rows client-side. If the JS-reduce approach is used intentionally (e.g., MVP, RLS constraints), add a comment naming the constraint and a follow-up slice.

**Applies to:** Any service that sums consumption readings for preview or reporting.
