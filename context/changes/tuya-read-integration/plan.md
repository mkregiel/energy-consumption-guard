# Tuya Read Integration Implementation Plan

## Overview

Implement foundation slice F-02: connect a user account to Tuya / Smart Life in read-only mode, fetch consumption from the linked meter, and persist normalized readings to Supabase.

This slice is backend-only by design. It proves integration viability and data flow before UI-heavy S-02 and background automation in F-03.

## Current State Analysis

- F-02 exists in roadmap as proposed and depends on F-01 (`context/foundation/roadmap.md`).
- F-01 is implemented: domain tables and RLS already exist, including `meters` and `consumption_readings` (`supabase/migrations/20260527120000_energy_domain_schema.sql`).
- API layer currently contains only auth routes using form + redirect style (`src/pages/api/auth/*.ts`).
- Middleware resolves session and protects `/dashboard` only; `/api/*` is not guarded yet (`src/middleware.ts`).
- Server env schema currently includes only Supabase secrets (`astro.config.mjs`).

## Desired End State

After this plan:

1. A user can complete Tuya OAuth linking and store tokens securely per user.
2. A user-authenticated sync endpoint can fetch consumption from Tuya and upsert to `consumption_readings`.
3. Duplicate readings are prevented by idempotency contract (`meter_id + recorded_at`).
4. New F-02 API endpoints use JSON responses, zod validation, and `export const prerender = false`.
5. The implementation works in Cloudflare `workerd` runtime using SDK-first approach with a documented HTTP fallback.

### Key Discoveries:

- Hard rules require full SSR and zod-validated API endpoints (`AGENTS.md`).
- Existing API conventions are auth-specific and not suitable as generic data API baseline (`src/pages/api/auth/signin.ts`).
- Domain schema already supports read ingestion (`consumption_readings.source` includes `tuya`) (`supabase/migrations/20260527120000_energy_domain_schema.sql`).
- Deploy notes flag potential Tuya SDK compatibility risk in `workerd` and recommend a spike/fallback strategy (`context/deployment/deploy-plan.md`).

## What We're NOT Doing

- UI for linking devices or displaying charts (S-02 scope)
- Scheduled/cron syncing (F-03 scope)
- Limit evaluation and breach event generation (F-03 scope)
- Email notifications (F-04 / S-05 scope)
- Multi-limit UX or logic (FR-006 scope)
- Integrations other than Tuya / Smart Life

## Implementation Approach

Use an incremental backend-first approach:

1. Establish contract and configuration for Tuya integration (env + route conventions).
2. Add secure persistence for OAuth tokens and idempotency constraints.
3. Implement Tuya service and API endpoints with SDK-first runtime check.
4. Verify end-to-end manual proof and handoff readiness for downstream slices.

The slice keeps user endpoints session-authenticated and introduces consistent JSON API behavior aligned with repository rules.

## Critical Implementation Details

### Timing & lifecycle

OAuth callback handling must persist tokens before any sync attempt is allowed. Sync endpoint should refuse execution when tokens are missing or expired and return a deterministic HTTP error contract so S-02 can build a predictable UX on top.

### State sequencing

Token refresh (when needed) must happen before the Tuya read call, and refreshed tokens must be saved atomically before writing readings. This prevents stale-token loops and duplicate partial writes.

### Debug & observability

Because runtime is Cloudflare Workers, integration failures should be traceable via structured route-level logs and a stable error code mapping (provider error -> API error), not only free-form messages.

## Phase 1: Tuya Contract and Runtime Configuration

### Overview

Define and enforce backend contract standards for F-02 routes and secrets before service implementation.

### Changes Required:

#### 1. Tuya environment contract

**File**: `astro.config.mjs`

**Intent**: Add server-only Tuya secrets to the env schema so runtime configuration is explicit and validated.

**Contract**: Extend env schema with Tuya-related secrets (for example client ID, client secret, and API region/base URL) using `context: "server"` and `access: "secret"`.

#### 2. Local env template update

**File**: `.env.example`

**Intent**: Document required Tuya variables for local setup without committing real values.

**Contract**: Add placeholder keys for all new Tuya env variables required by the service and OAuth flow.

#### 3. API route baseline for F-02

**File**: `src/pages/api/tuya/*` (new routes in this phase can be skeleton stubs)

**Intent**: Establish JSON + zod + `prerender = false` route baseline before implementing provider calls.

**Contract**: Each new route exports uppercase HTTP method handler, `export const prerender = false`, validates input with zod, and returns structured JSON status responses.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build`
- Linting passes: `npm run lint`
- New Tuya route files compile with `prerender = false` and zod-based input contracts

#### Manual Verification:

- Missing Tuya env values produce explicit configuration errors instead of silent failures
- API responses for invalid payloads return predictable JSON error shape and HTTP status

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: OAuth Token Persistence and Idempotency Model

### Overview

Add database support for per-user Tuya OAuth credentials and deduplicated reading ingestion.

### Changes Required:

#### 1. OAuth token storage migration

**File**: `supabase/migrations/YYYYMMDDHHmmss_tuya_oauth_tokens.sql`

**Intent**: Persist OAuth access/refresh tokens per user securely, as required by OAuth-per-user decision.

**Contract**: New table (or extension pattern) includes `user_id` ownership, encrypted/secure token fields, expiry metadata, timestamps, RLS enabled and policies scoped to `auth.uid()` (plus service role grants as needed).

#### 2. Reading idempotency migration

**File**: `supabase/migrations/YYYYMMDDHHmmss_readings_idempotency.sql` (or combined with token migration)

**Intent**: Ensure retries do not duplicate readings.

**Contract**: Add uniqueness guarantee on reading identity (`meter_id`, `recorded_at`) and align ingestion contract to upsert semantics.

#### 3. Shared type contracts

**File**: `src/types.ts`

**Intent**: Keep DTO/entity contracts centralized for new Tuya-related persistence and request/response models.

**Contract**: Add interfaces/types for Tuya connection/token metadata and route payload/response DTOs needed by F-02 service and endpoints.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly on local DB: `npx supabase db reset`
- Linting passes: `npm run lint`
- Type checking passes: `npm run build`

#### Manual Verification:

- RLS enforces token ownership per user
- Duplicate insert attempt for same `meter_id + recorded_at` is deduplicated by upsert/constraint behavior

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Tuya Service and API Endpoints

### Overview

Implement OAuth callback and on-demand sync flow using SDK-first strategy with in-scope fallback to signed HTTP client.

### Changes Required:

#### 1. Tuya service layer

**File**: `src/lib/services/tuya-client.ts` and related service files

**Intent**: Encapsulate provider communication, token refresh, and response normalization away from route handlers.

**Contract**: Service exposes stable methods for OAuth exchange/refresh and consumption read retrieval. Public method signatures remain stable regardless of SDK or HTTP fallback implementation.

#### 2. OAuth callback endpoint

**File**: `src/pages/api/tuya/oauth/callback.ts`

**Intent**: Complete provider linking and persist per-user credentials.

**Contract**: Validates callback payload/state with zod, binds credentials to authenticated user context, returns JSON success/failure contract.

#### 3. On-demand sync endpoint

**File**: `src/pages/api/tuya/sync.ts`

**Intent**: Fetch latest consumption and persist normalized reading for the linked meter.

**Contract**: Requires user session, resolves linked meter, reads Tuya consumption, writes to `consumption_readings` with idempotent upsert, returns deterministic JSON result.

#### 4. SDK compatibility fallback

**File**: `src/lib/services/tuya-client.ts` (and optional adapter file)

**Intent**: Keep F-02 delivery unblocked if SDK fails in `workerd`.

**Contract**: If runtime compatibility check fails, route handlers keep same contract while service switches to lightweight signed HTTP implementation.

### Success Criteria:

#### Automated Verification:

- Linting passes: `npm run lint`
- Type checking passes: `npm run build`
- All new routes and services compile in local Cloudflare dev runtime

#### Manual Verification:

- User can complete link flow and credentials persist per user
- Triggering sync writes a new/updated reading row in `consumption_readings`
- Repeating sync for same timestamp does not create duplicates
- Provider/runtime failures return mapped, actionable API errors

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Verification and Handoff

### Overview

Validate F-02 end-to-end proof and prepare clean handoff to S-02 and F-03.

### Changes Required:

#### 1. End-to-end proof verification

**File**: `context/changes/tuya-read-integration/change.md`

**Intent**: Record that F-02 acceptance proof was achieved.

**Contract**: Notes confirm: user links Tuya account, runs sync, and reading persists in `consumption_readings` for the correct meter.

#### 2. Readiness notes for downstream slices

**File**: `context/changes/tuya-read-integration/change.md` (notes section update)

**Intent**: Make downstream implementation dependencies explicit for S-02 and F-03.

**Contract**: Document API endpoints and data contracts now available, plus any deferred work.

### Success Criteria:

#### Automated Verification:

- Local build passes: `npm run build`
- Linting passes: `npm run lint`
- Local migration reset passes with all F-01 + F-02 migrations: `npx supabase db reset`

#### Manual Verification:

- End-to-end acceptance proof completed with real Tuya account
- No regression in existing auth flow (`/api/auth/*`, `/dashboard` guard behavior)
- Team confirms F-02 is ready to unblock S-02 and F-03 planning

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- No dedicated unit test runner is configured in this repository; rely on strict type/lint checks for contract safety.

### Integration Tests:

- Validate route behavior through local Cloudflare runtime (`npm run dev`) and real request flows.
- Validate DB constraints and RLS with local Supabase reset and ownership checks.

### Manual Testing Steps:

1. Configure Tuya env secrets locally and run app in Cloudflare dev mode.
2. Authenticate user and complete OAuth callback flow.
3. Call sync endpoint and confirm row in `consumption_readings`.
4. Repeat sync for same reading timestamp and confirm no duplicate row.
5. Confirm invalid payload/token errors return expected JSON + HTTP status.

## Performance Considerations

- Sync endpoint should keep provider call path short and avoid heavy aggregation.
- Idempotent writes prevent unbounded growth from retries.
- Token refresh should be done only when necessary to limit provider round-trips.

## Migration Notes

- F-02 introduces additional migrations after F-01; production apply still requires explicit human approval.
- If token schema evolves later, prefer forward-only migrations over in-place destructive changes.

## References

- Roadmap slice F-02: `context/foundation/roadmap.md`
- Product constraints and guardrails: `context/foundation/prd.md`
- Existing schema baseline (F-01): `supabase/migrations/20260527120000_energy_domain_schema.sql`
- Existing auth/middleware baseline: `src/pages/api/auth/signin.ts`, `src/middleware.ts`
- Runtime and deployment risks: `context/deployment/deploy-plan.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Tuya Contract and Runtime Configuration

#### Automated

- [x] 1.1 Type checking passes (`npm run build`) — 7b6cf97
- [x] 1.2 Linting passes (`npm run lint`) — 7b6cf97
- [x] 1.3 New Tuya route files compile with `prerender = false` and zod contracts — 7b6cf97

#### Manual

- [x] 1.4 Missing Tuya env values produce explicit configuration errors — 7b6cf97
- [x] 1.5 Invalid payloads return predictable JSON error shape and HTTP status — 7b6cf97

### Phase 2: OAuth Token Persistence and Idempotency Model

#### Automated

- [x] 2.1 Migration applies cleanly on local DB (`npx supabase db reset`) — 4838d81
- [x] 2.2 Linting passes (`npm run lint`) — 4838d81
- [x] 2.3 Type checking passes (`npm run build`) — 4838d81

#### Manual

- [x] 2.4 RLS enforces token ownership per user — 4838d81
- [x] 2.5 Duplicate reading inserts are deduplicated by contract — 4838d81

### Phase 3: Tuya Service and API Endpoints

#### Automated

- [x] 3.1 Linting passes (`npm run lint`)
- [x] 3.2 Type checking passes (`npm run build`)
- [x] 3.3 Routes and services compile in local Cloudflare runtime

#### Manual

- [x] 3.4 User completes link flow and credentials persist per user
- [x] 3.5 Sync writes reading row in `consumption_readings`
- [x] 3.6 Repeated sync for same timestamp does not create duplicates
- [x] 3.7 Provider/runtime failures return mapped API errors

### Phase 4: Verification and Handoff

#### Automated

- [ ] 4.1 Local build passes (`npm run build`)
- [ ] 4.2 Linting passes (`npm run lint`)
- [ ] 4.3 Local migration reset passes (`npx supabase db reset`)

#### Manual

- [ ] 4.4 End-to-end acceptance proof completed with real Tuya account
- [ ] 4.5 Existing auth flow has no regressions
- [ ] 4.6 F-02 is confirmed ready to unblock S-02 and F-03
