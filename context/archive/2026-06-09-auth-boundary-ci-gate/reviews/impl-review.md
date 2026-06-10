<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Auth Boundary + CI Gate

- **Plan**: context/changes/auth-boundary-ci-gate/plan.md
- **Scope**: Phases 1-3 of 3 (full plan)
- **Date**: 2026-06-10
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | PASS    |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

## Success criteria re-verification

- `npm run test:unit` — 20/20 tests pass (4 files: consumption-window, consumption-preview-predicate, auth-guard, auth-boundary)
- `npx eslint` on all Phase 1+2 changed files — clean

## Findings

### F1 — Unplanned astro:middleware shim added to vitest.config.ts

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: vitest.config.ts:11-19
- **Detail**: The plan's "Changes Required" only listed src/middleware.ts, src/lib/**tests**/auth-guard.test.ts, src/pages/api/**tests**/auth-boundary.test.ts, package.json, and .github/workflows/ci.yml. During Phase 1, exporting `isPublicApiRoute` caused the test file to import the whole middleware.ts module, which transitively imports `astro:middleware` — unresolvable under Vitest. A second virtual-module shim (mirroring the existing astro:env/server shim, returning `export const defineMiddleware = (fn) => fn;`) was added to fix this. This is a correct, minimally-scoped, test-only fix — a direct and foreseeable consequence of Phase 1's own export change that the plan's research didn't trace through. No runtime behavior is affected.
- **Fix**: No code action needed — already implemented correctly. Added a note to plan.md Phase 1 Key Discoveries documenting the shim.
- **Decision**: FIXED + ACCEPTED-AS-RULE: "Exporting from an Astro-virtual-module-importing file requires a matching Vitest shim" (context/foundation/lessons.md)

### F2 — Manual checkboxes (1.3, 2.3, 3.3) confirmed verbally, no diff evidence

- **Severity**: OBSERVATION
- **Impact**: LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: context/changes/auth-boundary-ci-gate/plan.md:234,245,256 (now 235,246,257 after F1 edit)
- **Detail**: All three Manual items are "temporarily break X, confirm it fails, restore" / "open a PR, confirm CI passes" checks. By nature these leave no permanent diff artifact. Confirmed at each phase gate during the implementation session.
- **Fix**: No action needed.
- **Decision**: SKIPPED
