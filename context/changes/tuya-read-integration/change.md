---
change-id: tuya-read-integration
title: Tuya read integration
status: implemented
created: 2026-05-28
updated: 2026-05-30
---

## Notes

Foundation slice F-02 from roadmap: read-only integration with Tuya / Smart Life to pull consumption from a user-linked meter and persist readings in Supabase. This plan assumes F-01 schema is already implemented and prepares backend contracts for S-02 and F-03.

## F-02 Acceptance Proof

Verified end-to-end (Phases 1–3 manual verification, Phase 4 automated re-check):

1. Authenticated user completes Tuya OAuth linking via `POST /api/tuya/oauth/callback` — tokens persist in `tuya_oauth_tokens` scoped to `auth.uid()`.
2. User triggers on-demand sync via `POST /api/tuya/sync` — normalized reading upserts into `consumption_readings` for the correct `meters` row (`source = 'tuya'`).
3. Repeated sync for the same `recorded_at` does not create duplicate rows (unique constraint on `meter_id + recorded_at`).
4. Provider/runtime failures return stable JSON error envelope with mapped `error.code` values.

## Handoff — Available for S-02 and F-03

### API Endpoints (session-authenticated, JSON + zod)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/tuya/oauth/callback` | POST | Exchange OAuth `code` + `state`, persist per-user tokens |
| `/api/tuya/sync` | POST | Fetch latest Tuya consumption and upsert reading |

Both routes export `prerender = false`, require `locals.user` (401 if missing), and return `{ ok: true, data: … }` or `{ ok: false, error: { code, message, details? } }`.

**OAuth callback request:** `{ code: string, state: string }` — optional cookie `tuya_oauth_state` validated when present.

**Sync request:** `{ meterId?: uuid, forceRefresh?: boolean }` — resolves user's meter when `meterId` omitted.

**Success sync response includes:** `meterId`, `reading` (`ConsumptionReading`), `transportMode` (`sdk` | `http`).

### Data Contracts

- **Types:** `src/types.ts` — `TuyaOAuthToken`, `TuyaSyncPayload`, `TuyaSyncResult`, `TuyaApiSuccess`/`TuyaApiErrorBody`.
- **Tables:** `tuya_oauth_tokens` (per-user OAuth), `consumption_readings` (idempotent via `meter_id + recorded_at`), `meters` (requires `tuya_device_id`).
- **Service layer:** `src/lib/services/tuya-client.ts` — `linkTuyaAccount`, `syncMeterReading`, token refresh before reads.
- **Error codes:** `TUYA_NOT_LINKED`, `TUYA_AUTH_FAILED`, `TUYA_TOKEN_EXPIRED`, `TUYA_METER_NOT_FOUND`, `TUYA_PROVIDER_ERROR`, `TUYA_READING_UNAVAILABLE`, `TUYA_CONFIG_MISSING`, `TUYA_STATE_MISMATCH`.

### Environment (server-only)

See `.env.example`: `TUYA_CLIENT_ID`, `TUYA_CLIENT_SECRET`, `TUYA_API_BASE_URL`, `TUYA_API_REGION`, `TUYA_AUTH_MODE`, plus optional cloud-device overrides.

### Deferred / Out of Scope (for downstream slices)

| Item | Target slice | Notes |
|------|--------------|-------|
| OAuth authorize redirect + UI linking flow | S-02 | Backend callback ready; S-02 must initiate OAuth and set `tuya_oauth_state` cookie |
| Device picker / meter registration UI | S-02 | `meters` row must exist with `tuya_device_id` before sync |
| Consumption dashboard / charts | S-02 | Read from `consumption_readings` via existing RLS |
| Scheduled/cron sync | F-03 | On-demand `POST /api/tuya/sync` is the integration hook |
| Limit evaluation against readings | F-03 | Reads `consumption_readings`; no Tuya calls needed |
| `/api/*` middleware guard | — | Routes self-check `locals.user`; global API guard still deferred |
| Production migration apply | — | Requires explicit human approval per deploy plan |
