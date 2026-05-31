---
change-id: tuya-device-and-consumption
title: Tuya device and consumption visibility
status: impl_reviewed
created: 2026-05-30
updated: 2026-05-31
---

## Notes

Roadmap slice S-02 (north star): connect an energy meter via Tuya / Smart Life and show consumption in the app. Builds on implemented F-01 (schema), F-02 (Tuya read integration), and S-01 (login). Meter REST API is included in this slice (F-05 deferred; routes use local session checks like F-02).

**Phase 1 (prerequisite):** local HTTPS dev via mkcert + `npm run dev:https` on `https://127.0.0.1:3000` — Tuya Developer Console rejects `http://` callback URLs.

## S-02 Acceptance Proof

Verified end-to-end (Phases 1–5 manual verification):

1. Local HTTPS dev (`npm run dev:https`) serves `https://127.0.0.1:3000` with trusted mkcert certificate; Tuya console accepts callback URL.
2. Authenticated user connects Tuya via OAuth H5 flow (`GET /api/tuya/oauth/start` → Tuya → `/dashboard/tuya/callback` → `POST /api/tuya/oauth/callback`); tokens persist in `tuya_oauth_tokens`.
3. User registers meter via device list or manual Device ID fallback; single `meters` row upserted per user.
4. User triggers sync from dashboard; latest reading appears in hero and history table (last 20 rows from `consumption_readings`).
5. Repeat sync for the same `recorded_at` does not duplicate rows (unique constraint on `meter_id + recorded_at`).
6. Error states (not linked, no meter, provider failure) show Polish inline banners with actionable CTAs.

## E2E Manual Test Checklist

Use `npm run dev:https` and `https://127.0.0.1:3000` for all steps.

| Step | Action | Expected |
|------|--------|----------|
| 1 | Sign in with test account | Redirect to `/dashboard` |
| 2 | Click **Połącz Tuya** | Redirect to Tuya H5; return to callback page with success |
| 3 | Verify `tuya_oauth_tokens` row | Row exists for user in Supabase Studio |
| 4 | Select device from list (or manual Device ID) | `meters` row created/updated with correct `tuya_device_id` |
| 5 | Click **Synchronizuj teraz** | Hero shows kWh + timestamp; table lists reading |
| 6 | Sync again within same window | No duplicate row for same `recorded_at` |
| 7 | Sign out; sign in as User B | User B cannot see User A meters/readings (RLS) |
| 8 | Error paths | Sync without meter → CTA to register; not linked → CTA to connect |

**Fallback path verified:** manual Device ID registration when device list empty → sync succeeds.

## Handoff — Available for S-03 and S-05

### API Endpoints (session-authenticated, JSON + zod)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/tuya/oauth/start` | GET | Set `tuya_oauth_state` cookie; redirect to Tuya authorize URL |
| `/api/tuya/oauth/callback` | POST | Exchange OAuth code; persist tokens (F-02) |
| `/api/tuya/status` | GET | Connection metadata (`linked`, `accessTokenExpiresAt`, `tuyaUid`) |
| `/api/tuya/devices` | GET | List user devices for meter picker |
| `/api/tuya/sync` | POST | Fetch consumption and upsert reading (F-02) |
| `/api/meters` | GET | Current meter or `null` |
| `/api/meters` | POST | Upsert meter (`label`, `tuya_device_id`, `tuya_product_id?`) |

All routes export `prerender = false`, require `locals.user` (401 if missing), and return `{ ok: true, data: … }` or `{ ok: false, error: { code, message, details? } }`.

### UI Routes and Components

| Path / component | Purpose |
|------------------|---------|
| `/dashboard` | Main dashboard: connect, register meter, consumption hero + table + sync |
| `/dashboard/tuya/callback` | OAuth return page |
| `TuyaConnectCard` | Link status + connect CTA |
| `MeterRegistrationForm` | Device picker + manual ID fallback |
| `ConsumptionHero` | Latest kWh reading |
| `ConsumptionReadingsTable` | Last 20 readings (table / mobile cards) |
| `SyncConsumptionButton` | On-demand sync with error banners |
| `TuyaErrorBanner` | Inline error with CTA or retry |

### Hooks

| Hook | Purpose |
|------|---------|
| `useTuyaOAuthCallback` | POST callback on OAuth return |
| `useTuyaDevices` | Fetch device list for picker |
| `useMeterUpsert` | POST meter upsert |
| `useTuyaSync` | POST sync; reload on success |

### Services and Helpers

| Module | Purpose |
|--------|---------|
| `src/lib/services/tuya-client.ts` | OAuth, sync, device list orchestration |
| `src/lib/services/meter-service.ts` | Meter get/upsert |
| `src/lib/services/consumption-query.ts` | SSR: latest + last N readings |
| `src/lib/tuya-error-messages.ts` | Polish error messages + CTAs for UI |

### Environment

See `.env.example`: `TUYA_CLIENT_ID`, `TUYA_CLIENT_SECRET`, `TUYA_API_BASE_URL`, `TUYA_API_REGION`, `TUYA_OAUTH_REDIRECT_URI` (must match Tuya console + `dev:https` origin).

### Known Limitations

| Item | Target slice | Notes |
|------|--------------|-------|
| Historical charts / aggregations | Deferred | Table of N readings is MVP display |
| Scheduled/cron sync | F-03 | On-demand sync only |
| Consumption limits UI/API | S-03 | Schema exists; no UI yet |
| Alarm email configuration | S-04 | — |
| Breach notification emails | S-05 | — |
| Global `/api/*` middleware guard | F-05 | Routes self-check `locals.user` |
| Multi-meter per user | Out of scope | One meter per user enforced by DB |

### S-03 Reuse Notes

- **Limits:** configure against `consumption_limits` table; evaluate readings from `consumption_readings` (no Tuya calls).
- **Dashboard patterns:** reuse `cn()`, cosmic card styling, `FormField`, `ServerError`, `TuyaErrorBanner` for limit configuration errors.
- **Data access:** SSR via Supabase + RLS; client mutations via dedicated API routes with zod validation.
