<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Protected API Routes

- **Plan**: context/changes/protected-api-routes/plan.md
- **Scope**: Full plan (Phases 1–3)
- **Date**: 2026-05-31
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

## Findings

### F1 — Unified 401 message vs. phase-3 manual criterion wording

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/auth-guard.ts:5
- **Detail**: Phase 3 manual success criterion says “Response JSON shape unchanged (only import path refactor)”. Handlers now return `error.message: "Authentication is required."` instead of route-specific strings (e.g. “User session is required for meter lookup.”). Envelope `{ ok, error: { code, message } }` is unchanged; `code` remains `UNAUTHORIZED`. Primary plan intent explicitly required a shared middleware/handler message.
- **Fix**: No code change required unless product wants route-specific copy back — then use distinct messages only outside 401 UNAUTHORIZED or document the intentional standardization in the plan addendum.
- **Decision**: SKIPPED (intentional per primary plan intent)

### F2 — OAuth start `<a href>` gets JSON 401 when session missing

- **Severity**: WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/middleware.ts:31-32; src/components/tuya/TuyaConnectCard.tsx:59
- **Detail**: `GET /api/tuya/oauth/start` is linked via plain `<a href>` from dashboard UI. Middleware returns JSON 401 before `requireUserRedirect` runs. Logged-in flow works (manual 3.5 passed). If session expires while the user stays on a protected page and they click the link, the browser shows raw JSON instead of a redirect to sign-in (pre-change handler redirected).
- **Fix A ⭐ Recommended**: Accept as documented edge case — dashboard middleware already redirects unauthenticated page loads; only stale-tab expiry is affected. Add a one-line comment on `oauth/start` or README noting browser navigation without session gets JSON 401.
  - Strength: Matches plan (“middleware blocks first”); zero code churn.
  - Tradeoff: Rare stale-session UX regression.
  - Confidence: HIGH — plan and manual sign-off cover the happy path.
  - Blind spot: Frequency of stale-tab clicks in production unknown.
- **Fix B**: Middleware branch for `GET /api/tuya/oauth/start` without session → `redirect` to sign-in (exception to JSON-only API rule).
  - Strength: Restores browser-friendly OAuth entry for expired sessions.
  - Tradeoff: Special-case in middleware; inconsistent 401 contract for one API path.
  - Confidence: MED — works but weakens deny-by-default uniformity.
  - Blind spot: Other `<a href>` API routes may need the same treatment.
- **Decision**: FIXED via Fix A (comment in oauth/start.ts + README edge-case note)

### F3 — Prefix allowlist `/api/auth/` is broad

- **Severity**: WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Scope Discipline
- **Location**: src/middleware.ts:6-9
- **Detail**: `pathname.startsWith("/api/auth/")` makes any future route under that prefix public at the middleware layer. A mistakenly added `/api/auth/admin` would be exposed without session.
- **Fix A ⭐ Recommended**: Document in AGENTS.md that only `signin`, `signup`, and `signout` may exist under `/api/auth/`; no new siblings without security review.
  - Strength: Preserves simple deny-by-default rule; matches current repo (three handlers only).
  - Tradeoff: Relies on discipline, not enforcement.
  - Confidence: HIGH — grep shows only the three auth handlers today.
  - Blind spot: Future contributors may not read AGENTS.md.
- **Fix B**: Replace prefix allowlist with explicit path set (`/api/auth/signin`, etc.).
  - Strength: Enforces least privilege at the edge.
  - Tradeoff: Must update middleware when adding auth endpoints (e.g. password reset).
  - Confidence: HIGH — mechanically correct.
  - Blind spot: POST-only routes need method-aware allowlist if paths overlap.
- **Decision**: FIXED via Fix A (AGENTS.md allowlist discipline note)

### F4 — `requireUserRedirect` unreachable without session

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Architecture
- **Location**: src/pages/api/tuya/oauth/start.ts:25-28
- **Detail**: Unauthenticated requests never reach the handler; redirect helper is defense-in-depth only (plan-accepted).
- **Fix**: Add a short comment above `requireUserRedirect` call: “Middleware returns JSON 401 first; redirect path is defense-in-depth.”
- **Decision**: SKIPPED (covered by F2 comment)
