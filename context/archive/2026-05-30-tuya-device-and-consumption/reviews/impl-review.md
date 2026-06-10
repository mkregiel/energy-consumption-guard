<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Tuya Device and Consumption Visibility

- **Plan**: context/changes/tuya-device-and-consumption/plan.md
- **Scope**: All 6 phases (full plan)
- **Date**: 2026-05-31
- **Verdict**: NEEDS ATTENTION (post-triage: fixes applied)
- **Findings**: 1 critical, 5 warnings, 3 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | FAIL    |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Findings

### F1 — OAuth state validation skipped when cookie absent

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/tuya/oauth/callback.ts:46-49
- **Detail**: State is validated only when `tuya_oauth_state` cookie exists (`if (expectedState && expectedState !== parsedPayload.data.state)`). When the cookie is missing (expired, wrong origin, cleared), any `code` + `state` pair is accepted for the logged-in user — classic OAuth CSRF linking risk.
- **Fix**: Require cookie presence and equality; reject with `TUYA_STATE_MISMATCH` when cookie is absent.
  - Strength: Matches `oauth/start.ts` contract; closes CSRF class entirely.
  - Tradeoff: Users who lose cookie mid-flow must restart OAuth (expected UX).
  - Confidence: HIGH — standard OAuth state pattern.
  - Blind spot: None significant.
- **Decision**: FIXED

### F2 — Broken UNAUTHORIZED login link

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/tuya-error-messages.ts:48
- **Detail**: `UNAUTHORIZED.actionHref` points to `/sign-in`; app uses `/auth/signin` everywhere else (middleware, oauth/start, auth UI). CTA in sync error banner leads to 404.
- **Fix**: Change `actionHref` to `/auth/signin`.
- **Decision**: FIXED

### F3 — signin API route missing prerender export

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/api/auth/signin.ts:1-5
- **Detail**: Route changed for `returnTo` support but lacks `export const prerender = false` required by AGENTS.md; all new Tuya/meter routes include it.
- **Fix**: Add `export const prerender = false` after imports.
- **Decision**: FIXED

### F4 — Meter upsert without Tuya device ownership check

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/meter-service.ts:15-44
- **Detail**: `upsertUserMeter` accepts any non-empty `tuya_device_id`. With `TUYA_CLOUD_*` configured, sync uses project token and can read consumption for arbitrary device IDs not owned by the linked user account.
- **Fix A ⭐ Recommended**: Validate device ID against `listLinkedUserDevices` on POST /api/meters; allow manual-only path when list API fails or returns empty (plan requirement).
  - Strength: Blocks cross-user device ID injection in cloud mode while preserving manual fallback.
  - Tradeoff: Extra Tuya API call on meter registration; manual path needs explicit bypass rules.
  - Confidence: MED — depends on cloud vs user-token deployment mix.
  - Blind spot: Haven't verified all Tuya account types return device lists.
- **Fix B**: Document as accepted risk for MVP; defer validation to S-03
  - Strength: Zero code change; manual fallback unchanged.
  - Tradeoff: Cloud-mode users can register arbitrary IDs until fixed.
  - Confidence: LOW — security gap remains in multi-tenant cloud setup.
  - Blind spot: Production env may always use user tokens.
- **Decision**: FIXED (Fix A)

### F5 — Consumption fallbacks store period totals as cumulative kWh

- **Severity**: ⚠️ WARNING
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: src/lib/services/tuya-http.ts:465-592
- **Detail**: Fallback chain (ele_usage, iot-03 trend, sum of add_ele logs) may return period/increment values but `upsertConsumptionReading` treats them as cumulative `kwh_cumulative` and computes `kwh_delta` against prior cumulative reading — producing wrong or zero deltas.
- **Fix A ⭐ Recommended**: Tag reading source/semantics in transport; only persist values confirmed cumulative; skip or flag period totals.
  - Strength: Correct data model for S-03 limits and S-05 alarms downstream.
  - Tradeoff: Some devices may show no reading until correct DP is found.
  - Confidence: MED — requires per-device DP knowledge.
  - Blind spot: Real device DP mapping not verified in review.
- **Fix B**: Document limitation in change.md; accept table display without reliable delta
  - Strength: Preserves current sync success rate.
  - Tradeoff: Misleading kWh values possible on fallback path.
  - Confidence: HIGH for short-term MVP.
  - Blind spot: Users may trust incorrect numbers.
- **Decision**: FIXED (Fix A)

### F6 — Device list 403 masked as empty array

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Reliability
- **Location**: src/lib/services/tuya-client.ts:267-268
- **Detail**: On Tuya 403, `listLinkedUserDevices` returns `[]` instead of auth error. UI shows empty device list and pushes manual ID entry, hiding expired/invalid Tuya session.
- **Fix**: Propagate 403 as `TUYA_AUTH_FAILED` or `TUYA_TOKEN_EXPIRED`; return empty array only on HTTP 200 with no devices.
- **Decision**: FIXED

### F7 — SSR consumption query errors silently swallowed

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Reliability
- **Location**: src/pages/dashboard.astro:31-34
- **Detail**: `getMeterConsumptionReadings` failures caught and replaced with empty arrays. Dashboard looks like "no readings" instead of a database/RLS error.
- **Fix**: Log server-side error and pass error flag to UI banner instead of silent empty state.
- **Decision**: FIXED

### F8 — Unnecessary client hydration on display-only components

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/pages/dashboard.astro:59-60
- **Detail**: `ConsumptionHero` and `ConsumptionReadingsTable` use `client:load` but only render SSR props — no hooks or client state. Adds JS bundle without benefit.
- **Fix**: Remove `client:load` or convert to `.astro` components.
- **Decision**: FIXED

### F9 — Missing certs/.gitkeep per plan

- **Severity**: 👁 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: certs/.gitkeep
- **Detail**: Plan specified `certs/.gitkeep`; folder maintained via `certs/README.md` instead.
- **Fix**: Add empty `certs/.gitkeep` or accept README as sufficient.
- **Decision**: FIXED
