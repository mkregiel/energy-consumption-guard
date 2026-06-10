<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Configure Consumption Limit

- **Plan**: context/changes/configure-consumption-limit/plan.md
- **Scope**: All Phases (1–4)
- **Date**: 2026-06-03
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical 4 warnings 3 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Findings

### F1 — Unguarded SSR calls on dashboard will 500 on DB failure

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/dashboard.astro:25, :41
- **Detail**: getUserLimit and getLimitWindowPreview were called without try/catch. A Supabase connectivity error throws and crashes the entire SSR render. getMeterConsumptionReadings (lines 33–38) is correctly guarded — limit calls should follow the same pattern.
- **Fix**: Wrap in try/catch blocks; set limit = null and limitPreview = null on error.
- **Decision**: FIXED

### F2 — limit-service throws plain Error instead of TuyaServiceError

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: src/lib/services/limit-service.ts:8, :34
- **Detail**: limit-service.ts threw new Error(...). meter-service.ts uses TuyaServiceError with a structured code + HTTP status. API route catch blocks fell back to generic INTERNAL_ERROR instead of tuyaErrorResponse(error).
- **Fix A ⭐ Applied**: Switch to TuyaServiceError in limit-service + tuyaErrorResponse in the route.
- **Decision**: FIXED via Fix A

### F3 — ConsumptionLimitForm uses raw inputs instead of FormField

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/limits/ConsumptionLimitForm.tsx:70–90
- **Detail**: Plan specified using the FormField component for inputs. The threshold input used a plain <input> with manually written label+icon wrapper.
- **Fix**: Replaced the manual label+input block with <FormField> for the threshold input.
- **Decision**: FIXED

### F4 — Missing window_type client-side guard in useLimitUpsert

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/components/hooks/useLimitUpsert.ts:31
- **Detail**: Plan required client-side checks for both "positive threshold" AND "window_type set". Only the threshold guard exists. In practice window_type defaults to "day" so it can never be unset.
- **Fix**: Add if (!payload.window_type) guard.
- **Decision**: SKIPPED — window_type can never be unset in practice given the form defaults

### F5 — Timezone hardcoded with no comment documenting MVP intent

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/limit-service.ts:27
- **Detail**: timezone: "Europe/Warsaw" is hardcoded per plan, but a future maintainer won't know it was intentional.
- **Fix**: Added inline comment: `// MVP: hardcoded per plan; S-04 can add a timezone picker`
- **Decision**: FIXED

### F6 — Preview query fetches all rows to sum in JS instead of DB aggregate

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/limit-consumption-preview.ts:22–33
- **Detail**: All kwh_delta rows in the window are fetched into memory and reduced in TypeScript. For a month window with many readings this grows unbounded.
- **Fix**: Added comment naming the constraint + follow-up note. Lesson recorded in context/foundation/lessons.md.
- **Decision**: FIXED + ACCEPTED-AS-RULE: In-app window sum: accept JS reduce for MVP, plan DB aggregate for follow-up

### F7 — Stale errorMessage not cleared before client-side threshold guard

- **Severity**: OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/hooks/useLimitUpsert.ts:31
- **Detail**: If the user gets a network error and then submits with threshold ≤ 0, the old network error stays visible while the new client-side error is set.
- **Fix**: Added setErrorMessage(null) before the threshold guard.
- **Decision**: FIXED
