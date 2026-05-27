# Energy Domain Schema Implementation Plan

## Overview

Implement foundation slice F-01: Supabase schema for the energy monitoring domain. Adds migratable tables for meters, consumption limits, time-series readings, notification settings, and limit breach events — all protected by RLS aligned with the PRD access model (one user, one household).

This change delivers schema + TypeScript types + documentation only. No API routes, services, or UI.

## Current State Analysis

- **Auth only:** `@supabase/supabase-js` client in `src/lib/supabase.ts` talks exclusively to `auth.users` via sign-in/sign-up/sign-out routes.
- **No migrations:** `supabase/migrations/` does not exist; `supabase/config.toml` has migrations enabled but empty `schema_paths`.
- **No domain types:** `src/types.ts` is absent (AGENTS.md expects shared entity types there).
- **No RLS patterns:** No SQL files or `auth.uid()` policies in the repo.
- **README outdated:** Line 118 states no database tables are required.

### Key Discoveries:

- Roadmap F-01 explicitly lists four entity groups plus breach events as downstream need (`context/foundation/roadmap.md:68-79`).
- Deploy plan requires human approval before production RLS/migration changes (`context/deployment/deploy-plan.md:340-343`).
- Infrastructure doc expects breach/job outcomes stored in Supabase (`context/foundation/infrastructure.md:108-111`).
- AGENTS.md mandates migration naming `YYYYMMDDHHmmss_description.sql` with RLS enabled.

## Desired End State

After this plan:

1. `supabase/migrations/<timestamp>_energy_domain_schema.sql` creates five domain tables with constraints, indexes, and RLS policies.
2. `src/types.ts` exports manual TypeScript interfaces/enums matching the schema.
3. README documents how to apply migrations locally and notes production approval gate.
4. `npm run lint` and `npm run build` still pass.
5. Local verification confirms RLS isolates rows per authenticated user.

## What We're NOT Doing

- Tuya OAuth token storage (deferred to F-02 `tuya-read-integration`)
- API routes for CRUD (F-05 `protected-api-routes`, slices S-02–S-04)
- Background limit evaluation or email sending (F-03, F-04)
- Multiple simultaneous limits per user (FR-006 — v2)
- Supabase CLI generated types or npm `db:*` scripts
- Dev seed data with fake Tuya readings
- Production migration execution (documented steps; human gate)
- `SUPABASE_SERVICE_ROLE_KEY` env variable

## Implementation Approach

Single forward migration containing all domain tables. Use PostgreSQL `CHECK` constraints for enum-like fields (`window_type`, `source`) instead of native ENUM types — easier to extend in future migrations.

RLS pattern: every table carries `user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE`. Policies grant full CRUD where `user_id = auth.uid()`. For `consumption_readings`, ownership is enforced via subquery through `meters` (no denormalized `user_id` on readings).

MVP cardinality constraints:

- One meter per user: `UNIQUE (user_id)` on `meters`
- One active limit per user: `UNIQUE (user_id)` on `consumption_limits`
- One notification settings row per user: `user_id` as primary key

## Phase 1: Energy Domain Migration

### Overview

Create the migration file with all domain tables, foreign keys, check constraints, indexes, and RLS policies.

### Changes Required:

#### 1. Migration SQL

**File:** `supabase/migrations/<YYYYMMDDHHmmss>_energy_domain_schema.sql`

**Intent:** Introduce the complete energy domain schema in one atomic migration so downstream slices have a stable contract.

**Contract:**

Tables and columns:

| Table | Purpose | Key columns |
| --- | --- | --- |
| `meters` | Registered Tuya energy meter | `id`, `user_id`, `label`, `tuya_device_id`, `tuya_product_id`, `created_at`, `updated_at` |
| `consumption_limits` | kWh threshold in calendar window | `id`, `user_id`, `threshold_kwh`, `window_type`, `timezone`, `created_at`, `updated_at` |
| `consumption_readings` | Time-series meter readings | `id`, `meter_id`, `recorded_at`, `kwh_cumulative`, `kwh_delta`, `source`, `created_at` |
| `notification_settings` | Alarm email address | `user_id`, `alarm_email`, `updated_at` |
| `limit_breach_events` | Limit breach audit + email idempotency | `id`, `limit_id`, `user_id`, `breached_at`, `consumption_kwh`, `notified_at`, `created_at` |

Constraints:

- `meters`: `UNIQUE (user_id)`; `tuya_device_id NOT NULL`; `label NOT NULL`
- `consumption_limits`: `UNIQUE (user_id)`; `threshold_kwh > 0`; `window_type IN ('day', 'week', 'month')`; `timezone NOT NULL DEFAULT 'Europe/Warsaw'`
- `consumption_readings`: FK `meter_id → meters(id) ON DELETE CASCADE`; `kwh_cumulative >= 0`; `source DEFAULT 'tuya'` with CHECK `source IN ('tuya', 'manual')`
- `notification_settings`: PK `user_id`; `alarm_email` validated as non-empty text (format validation in app layer S-04)
- `limit_breach_events`: FK `limit_id → consumption_limits(id) ON DELETE CASCADE`; FK `user_id → auth.users`; `consumption_kwh >= 0`

Indexes:

- `consumption_readings (meter_id, recorded_at DESC)` — time-range queries for F-03
- `limit_breach_events (limit_id, breached_at DESC)` — idempotency / recent breach lookup for F-04
- `limit_breach_events (user_id, breached_at DESC)` — user-scoped audit

RLS (enable + force on all five tables):

- `meters`, `consumption_limits`, `notification_settings`, `limit_breach_events`: standard `user_id = auth.uid()` for SELECT/INSERT/UPDATE/DELETE
- `consumption_readings`: policies use `EXISTS (SELECT 1 FROM meters m WHERE m.id = meter_id AND m.user_id = auth.uid())` for all operations

Triggers (optional, recommended):

- `updated_at` auto-update trigger on `meters`, `consumption_limits`, `notification_settings` — reuse Supabase/moddatetime pattern if available, or simple `BEFORE UPDATE` trigger setting `now()`

#### 2. Migrations directory bootstrap

**File:** `supabase/migrations/` (directory creation)

**Intent:** Establish the migrations folder expected by Supabase CLI and AGENTS.md.

**Contract:** Directory exists; contains exactly one migration file for this change.

### Success Criteria:

#### Automated Verification:

- Migration file exists matching pattern `supabase/migrations/*_energy_domain_schema.sql`
- SQL syntax valid: `npx supabase db reset` completes without error (requires local Supabase running)
- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- Supabase Studio shows all five tables under `public` schema
- RLS enabled on each table (shield icon / `\d+ tablename` shows policies)
- Insert as User A succeeds for own rows; select as User B returns zero rows for User A's data
- `consumption_readings` insert fails when `meter_id` belongs to another user

**Implementation Note:** After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: TypeScript Types and Documentation

### Overview

Add manual domain types matching the migration schema and update README so developers know migrations are required.

### Changes Required:

#### 1. Domain types

**File:** `src/types.ts`

**Intent:** Provide shared entity/DTO types for downstream slices (F-02, F-05, S-02–S-05) without generated Supabase types.

**Contract:** Export:

- String union types: `WindowType = 'day' | 'week' | 'month'`, `ReadingSource = 'tuya' | 'manual'`
- Entity interfaces: `Meter`, `ConsumptionLimit`, `ConsumptionReading`, `NotificationSettings`, `LimitBreachEvent`
- Insert/Omit variants where useful: e.g. `MeterInsert` (without `id`, `created_at`, `updated_at`), `ConsumptionReadingInsert`
- Field types mirror SQL: `id`/`user_id`/`meter_id`/`limit_id` as `string` (UUID), numerics as `number`, timestamps as `string` (ISO)

#### 2. README migration section

**File:** `README.md`

**Intent:** Replace the outdated "No database tables or migrations are required" statement with accurate migration workflow.

**Contract:**

- Remove or replace line ~118 assertion about no migrations
- Add short section covering:
  - Local: `npx supabase start` then `npx supabase db reset` applies migrations
  - Production: `npx supabase link` + `npx supabase db push` with human approval (reference deploy-plan gate)
  - List of domain tables at high level (names only)

### Success Criteria:

#### Automated Verification:

- `src/types.ts` exists and exports all five entity interfaces
- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- Type field names match migration column names (spot-check in Studio vs `src/types.ts`)
- README accurately describes migration workflow for new contributors

**Implementation Note:** After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Local Verification and Handoff

### Overview

Run end-to-end local verification of the migration and RLS, document production migration steps in plan progress notes if needed.

### Changes Required:

#### 1. Local database reset

**File:** (no file changes — verification commands)

**Intent:** Confirm migration applies cleanly on fresh local database.

**Contract:** `npx supabase db reset` exits 0; all tables present.

#### 2. RLS smoke test script (manual)

**File:** (no file changes — manual SQL in Studio or psql)

**Intent:** Verify cross-user isolation before any production push.

**Contract:** Manual test checklist:

1. Create two test users via auth signup
2. As User A: insert meter, limit, notification_settings
3. As User B: verify SELECT returns empty for User A tables
4. As User A: insert reading linked to own meter — succeeds
5. As User A: attempt reading with fabricated `meter_id` — fails RLS

#### 3. Change status

**File:** `context/changes/energy-domain-schema/change.md`

**Intent:** Mark change ready for downstream implementation slices.

**Contract:** `status: implemented` only after all progress checkboxes complete (set during `/10x-implement`).

### Success Criteria:

#### Automated Verification:

- `npx supabase db reset` completes without error
- `npm run lint` passes
- `npm run build` passes

#### Manual Verification:

- RLS smoke test checklist passes for two-user scenario
- Production migration steps understood (human approval before cloud push)

**Implementation Note:** After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- Not applicable — no test runner configured (AGENTS.md). Schema verified via migration apply + manual RLS checks.

### Integration Tests:

- Local `supabase db reset` as integration test for migration syntax and ordering
- Manual two-user RLS scenario (Phase 3)

### Manual Testing Steps:

1. Start local Supabase: `npx supabase start`
2. Apply migrations: `npx supabase db reset`
3. Open Studio at `http://localhost:54323` — confirm five tables
4. Create two auth users; run RLS smoke test (Phase 3 checklist)
5. Verify README instructions match actual workflow

## Performance Considerations

- Index on `(meter_id, recorded_at DESC)` supports F-03 window aggregation without full table scan for typical household reading volume (polls every 1–60 min).
- `UNIQUE (user_id)` on meters/limits keeps MVP queries simple (no multi-row limit logic).
- No partitioning or retention policy in v1 — revisit if reading volume grows beyond thousands of rows per meter.

## Migration Notes

**Local development:**

```powershell
npx supabase start
npx supabase db reset
```

**Production (human gate — do not automate in CI):**

1. Review migration SQL in PR
2. Human approval per deploy-plan
3. `npx supabase link --project-ref <ref>`
4. `npx supabase db push`
5. Verify tables in Supabase dashboard

**Rollback:** Supabase migrations do not auto-rollback with Worker deploy. Forward-fix strategy: new migration to revert changes if needed. Do not use destructive rollback on production without backup.

**Forward compatibility:**

- F-02 adds Tuya OAuth credentials (separate table or columns via new migration)
- FR-006 multiple limits: drop `UNIQUE (user_id)` on `consumption_limits`, add `label` or `limit_kind` column
- F-03 cron uses service role key — not part of this change

## References

- Roadmap F-01: `context/foundation/roadmap.md:68-79`
- PRD business logic: `context/foundation/prd.md:88-102`
- Deploy approval gate: `context/deployment/deploy-plan.md:340-343`
- AGENTS.md migration convention: `AGENTS.md`
- Supabase client baseline: `src/lib/supabase.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: Energy Domain Migration

#### Automated

- [x] 1.1 Migration file exists matching pattern `supabase/migrations/*_energy_domain_schema.sql`
- [x] 1.2 `npx supabase db reset` completes without error
- [x] 1.3 `npm run lint` passes
- [x] 1.4 `npm run build` passes

#### Manual

- [ ] 1.5 Supabase Studio shows all five tables under `public` schema
- [ ] 1.6 RLS enabled on each table with expected policies
- [ ] 1.7 Cross-user isolation verified (User B cannot read User A rows)

### Phase 2: TypeScript Types and Documentation

#### Automated

- [x] 2.1 `src/types.ts` exists and exports all five entity interfaces
- [x] 2.2 `npm run lint` passes
- [x] 2.3 `npm run build` passes

#### Manual

- [ ] 2.4 Type field names match migration column names
- [ ] 2.5 README accurately describes migration workflow

### Phase 3: Local Verification and Handoff

#### Automated

- [ ] 3.1 `npx supabase db reset` completes without error
- [ ] 3.2 `npm run lint` passes
- [ ] 3.3 `npm run build` passes

#### Manual

- [ ] 3.4 RLS smoke test checklist passes for two-user scenario
- [ ] 3.5 Production migration steps understood (human approval before cloud push)
