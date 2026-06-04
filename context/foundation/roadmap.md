---
project: Monitor zużycia prądu w gospodarstwie domowym
version: 1
status: in_progress
created: 2026-05-25
updated: 2026-06-04
prd_version: 1
main_goal: speed
top_blocker: time
---

# Roadmap: Monitor zużycia prądu w gospodarstwie domowym

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

Właściciel domu traci kontrolę nad zużyciem prądu, gdy rachunek w danym okresie skacze względem roku wcześniej — przyczyna nie jest od razu widoczna. Status quo (ręczne zdjęcia licznika, brak alertu przy limicie) nie daje codziennej widoczności ani wczesnego sygnału. Produkt ma zastąpić rytuał odczytu integracją Tuya / Smart Life, limitem kWh w oknie czasowym i powiadomieniem email przy przekroczeniu.

## North star

**S-02: Podłączenie licznika Tuya i widoczność zużycia** — ~~Najwcześniejszy dowód, że dane z licznika realnie trafiają do aplikacji~~ **Done (2026-05-31).** OAuth Tuya, rejestracja licznika, synchronizacja odczytów i dashboard zużycia działają end-to-end (`context/changes/tuya-device-and-consumption/`).

> **Gwiazda przewodnia — osiągnięta.** Kolejny focus: konfiguracja limitu (S-03) + email alarmowy (S-04) równolegle, potem F-04 + S-05 domknięcie US-01.

## At a glance

| ID   | Change ID                   | Outcome (user can …)                                                                        | Prerequisites                | PRD refs                         | Status   |
| ---- | --------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------- | -------------------------------- | -------- |
| F-01 | energy-domain-schema        | (foundation) persist meters, limits, and consumption readings in Supabase                   | —                            | NFR (background), Business Logic | done     |
| F-02 | tuya-read-integration       | (foundation) read consumption from Tuya / Smart Life without altering user’s platform setup | F-01                         | FR-002, Guardrails               | done     |
| F-03 | background-limit-evaluation | (foundation) periodic job compares stored consumption against configured limits             | F-01                         | NFR (background), FR-005         | done     |
| F-04 | transactional-email-alerts  | (foundation) send alarm emails to a configured address on limit breach                      | F-01                         | FR-004, FR-005, US-01            | done     |
| F-05 | protected-api-routes        | (foundation) authenticated API routes for device, limit, and notification configuration     | —                            | FR-001, Access Control           | done     |
| S-01 | user-login                  | log in with email and password                                                              | —                            | FR-001, US-01                    | done     |
| S-02 | tuya-device-and-consumption | connect an energy meter via Tuya / Smart Life and see current consumption in the app        | F-01, F-02, F-05, S-01       | FR-002, US-01                    | done     |
| S-03 | configure-consumption-limit | set an energy limit (kWh) within a configured time window                                   | S-02, F-01, F-05             | FR-003, US-01                    | done     |
| S-04 | configure-alarm-email       | set the email address used for alarm notifications                                          | S-01, F-01, F-05             | FR-004, US-01                    | done     |
| S-05 | email-alarm-on-limit-breach | receive an email when consumption in the configured window exceeds the limit                | S-02, S-03, S-04, F-03, F-04 | FR-005, US-01                    | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                 | Chain                                 | Note                                                                                  |
| ------ | --------------------- | ------------------------------------- | ------------------------------------------------------------------------------------- |
| A      | Dane i Tuya           | ~~`F-01` → `F-02` → `S-02`~~ **done** | Gwiazda przewodnia osiągnięta; cron sync co godzinę (`F-03`) utrzymuje odczyty w tle. |
| B      | Alarm w tle           | `F-04` → `S-05`                       | `F-03` done — ewaluacja limitów co godzinę; brakuje wysyłki email (`F-04`).           |
| C      | Konfiguracja limitów  | ~~`S-03`~~ **done**                   | GET/POST `/api/limits`, inline form + window preview na dashboardzie (2026-06-03).    |
| D      | Konto i powiadomienia | ~~`S-04`~~ **done**                   | GET/POST `/api/notifications`, `AlarmEmailForm` na dashboardzie (2026-06-04).         |

## Baseline

What's already in place in the codebase as of `2026-06-01` (auto-researched from repo + change folders).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 6 + React islands, Tailwind, shadcn; dashboard Tuya (`src/pages/dashboard.astro`, `src/components/tuya/`, `src/components/consumption/`)
- **Backend / API:** present — Astro SSR + Cloudflare Worker; auth (`/api/auth/*`), Tuya (`/api/tuya/*`), meters (`/api/meters`), cron (`/api/cron/*`); middleware guard na `/dashboard` i `/api/*` (`src/middleware.ts`, `src/lib/auth-guard.ts`)
- **Data:** present — Supabase migrations: `energy_domain_schema`, `tuya_oauth_tokens`, breach idempotency (`supabase/migrations/`); tabele: `meters`, `consumption_limits`, `consumption_readings`, `notification_settings`, `limit_breach_events`, `tuya_oauth_tokens`
- **Auth:** present — Supabase email/password; session via cookies; globalny guard API (deny-by-default, allowlist `/api/auth/*`)
- **Tuya integration:** present — OAuth H5, token refresh, on-demand sync, device list (`src/lib/services/tuya-client.ts`)
- **Background jobs:** present — Cloudflare cron via `src/scheduled.ts` + `src/worker.ts`: batch sync (`0 * * * *`), limit evaluation (`5 * * * *`); HTTP fallback z `CRON_SECRET`
- **Deploy / infra:** present — Cloudflare Pages/Workers, GitHub Actions CI (`.github/workflows/ci.yml`, `wrangler.jsonc`); runbook w `context/deployment/deploy-plan.md`
- **Observability:** partial — `wrangler.jsonc` observability; brak Sentry/Datadog w kodzie aplikacji
- **Not yet built:** UI/API limitów (S-03), UI/API email alarmowego (S-04), wysyłka email przy breach (F-04, S-05)

## Foundations

### F-01: Energy domain schema

- **Outcome:** (foundation) Supabase tables and RLS for meters, limits, consumption readings, and notification settings exist and are migratable.
- **Change ID:** energy-domain-schema
- **PRD refs:** Business Logic, NFR (background operation)
- **Unlocks:** S-02, S-03, S-04, S-05
- **Prerequisites:** —
- **Parallel with:** F-05
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Bez schematu każdy kolejny slice utknąłby na ad-hoc storage — na `speed` to pierwszy blocker techniczny przed Tuya.
- **Status:** done
- **Completed:** 2026-05-27 — `context/changes/energy-domain-schema/`; migracja `20260527120000_energy_domain_schema.sql`

### F-02: Tuya read integration

- **Outcome:** (foundation) server can pull consumption from a user-linked Tuya / Smart Life device read-only, respecting Guardrails (no disruption to existing Smart Life setup).
- **Change ID:** tuya-read-integration
- **PRD refs:** FR-002, Guardrails (Tuya / Smart Life)
- **Unlocks:** S-02 (north star), S-05
- **Prerequisites:** F-01
- **Parallel with:** F-05
- **Blockers:** —
- **Unknowns:** ~~Jakie uprawnienia / flow OAuth Tuya są wymagane dla licznika energii użytkownika?~~ Rozstrzygnięte: OAuth H5 + token refresh (`tuya_oauth_tokens`).
- **Risk:** Integracja poza starterem (tech-stack.md); największe ryzyko czasowe — dlatego north star celował w ten slice przed alarmem email.
- **Status:** done
- **Completed:** 2026-05-30 — `context/changes/tuya-read-integration/`; migracja `20260528120000_tuya_oauth_tokens_and_readings_idempotency.sql`

### F-03: Background limit evaluation

- **Outcome:** (foundation) scheduled worker periodically loads consumption, evaluates limits, and emits breach events (no email yet).
- **Change ID:** background-limit-evaluation
- **PRD refs:** NFR (background), FR-005
- **Unlocks:** S-05
- **Prerequisites:** F-01
- **Parallel with:** F-04, F-02
- **Blockers:** —
- **Unknowns:** ~~Gdzie uruchomić cron/worker przy deploy na Cloudflare?~~ Rozstrzygnięte: Cloudflare Workers cron (`src/scheduled.ts`, `src/worker.ts`) + HTTP fallback.
- **Risk:** FR-005 wymaga działania bez użytkownika — bez joba S-05 to tylko UI, nie produkt.
- **Status:** done
- **Completed:** 2026-05-31 — `context/changes/background-limit-evaluation/`; cron sync `:00`, evaluate `:05` UTC; migracja `20260531193000_limit_breach_events_window_start_unique.sql`

### F-04: Transactional email alerts

- **Outcome:** (foundation) application can send a plain-text alarm email to a stored address when a breach event fires.
- **Change ID:** transactional-email-alerts
- **PRD refs:** FR-004, FR-005, US-01
- **Unlocks:** S-05
- **Prerequisites:** F-01
- **Parallel with:** F-03, F-02
- **Blockers:** —
- **Unknowns:**
  - Który dostawca email (Resend, SendGrid, Supabase Edge, inny) i limity darmowego tieru? — Owner: user. Block: no.
- **Risk:** Ostatni element US-01 — sekwencjonowany po Tuya i konfiguracji, żeby nie budować emaili przed dowodem danych z licznika.
- **Status:** done
- **Completed:** 2026-06-02 — `context/changes/transactional-email-alerts/`; Resend client, breach notification job, cron `:10` UTC, retry policy (`notification_attempt_count`, `notification_failed_at`)

### F-05: Protected API routes

- **Outcome:** (foundation) device, limit, and notification API routes require the same session as the dashboard.
- **Change ID:** protected-api-routes
- **PRD refs:** FR-001, Access Control
- **Unlocks:** S-02, S-03, S-04
- **Prerequisites:** —
- **Parallel with:** F-01
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Baseline ma auth, ale middleware nie obejmuje `/api/*` — bez tego konfiguracja licznika byłaby otwarta.
- **Status:** done
- **Completed:** 2026-05-31 — `context/changes/protected-api-routes/`; middleware deny-by-default na `/api/*`, `requireUser()` w handlerach

## Slices

### S-01: User login

- **Outcome:** user can log in with email and password and reach the authenticated area of the app.
- **Change ID:** user-login
- **PRD refs:** FR-001, US-01
- **Prerequisites:** —
- **Parallel with:** F-01, F-05
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Baseline Supabase auth już istnieje — slice może być głównie weryfikacją i UX, nie greenfield auth.
- **Status:** done

### S-02: Tuya device and consumption visibility

- **Outcome:** user can connect an energy meter via Tuya / Smart Life and see consumption data in the app (north star).
- **Change ID:** tuya-device-and-consumption
- **PRD refs:** FR-002, US-01
- **Prerequisites:** F-01, F-02, F-05, S-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - ~~Czy w MVP wystarczy ostatni odczyt / suma w oknie, czy wykres historyczny?~~ Rozstrzygnięte: ostatni odczyt + tabela 20 odczytów (bez wykresu).
- **Risk:** Dowód hipotezy produktu — bez tego limity i email nie mają źródła prawdy; `top_blocker: time` sugeruje nie rozszerzać UI poza must-have.
- **Status:** done
- **Completed:** 2026-05-31 — `context/changes/tuya-device-and-consumption/`; dashboard OAuth + meter + sync + consumption UI

### S-03: Configure consumption limit

- **Outcome:** user can set an energy limit (kWh) within a configured time window.
- **Change ID:** configure-consumption-limit
- **PRD refs:** FR-003, US-01
- **Prerequisites:** S-02, F-01, F-05
- **Parallel with:** S-04
- **Blockers:** —
- **Unknowns:**
  - Semantyka okna czasowego (kalendarzowe vs rolling) — Owner: user. Block: no (MVP może iść na domyślnym, np. doba kalendarzowa).
- **Risk:** Fałszywe alarmy zależą od definicji okna — warto rozstrzygnąć przed S-05, nie blokuje planowania S-03.
- **Status:** done
- **Completed:** 2026-06-03 — `context/changes/configure-consumption-limit/`; GET/POST `/api/limits`, inline form on dashboard with progress bar and window preview

### S-04: Configure alarm email

- **Outcome:** user can set the email address that receives alarm notifications.
- **Change ID:** configure-alarm-email
- **PRD refs:** FR-004, US-01
- **Prerequisites:** S-01, F-01, F-05
- **Parallel with:** S-03
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Prosty CRUD — równoległy ze S-03 po north star, żeby skrócić ścieżkę do US-01.
- **Status:** done
- **Completed:** 2026-06-04 — `context/changes/configure-alarm-email/`; GET/POST `/api/notifications`, `AlarmEmailForm` na dashboardzie

### S-05: Email alarm on limit breach

- **Outcome:** user receives an email notification when consumption in the configured time window exceeds the configured limit (pełne US-01).
- **Change ID:** email-alarm-on-limit-breach
- **PRD refs:** FR-005, US-01
- **Prerequisites:** S-02, S-03, S-04, F-03, F-04
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Czy w MVP wystarczy wyłącznie reguła progu (FR-005), bez heurystyki anomalii z wizji? — Owner: user. Block: no (Non-Goals wykluczają ML w v1).
- **Risk:** Zamknięcie Primary Success Criteria — zależy od wszystkich warstw; przy `time` FR-006 i polish zostają w Parked.
- **Status:** proposed

## Backlog Handoff

| Roadmap ID | Change ID                   | Suggested issue title                            | Ready for `/10x-plan` | Notes                                                    |
| ---------- | --------------------------- | ------------------------------------------------ | --------------------- | -------------------------------------------------------- |
| F-04       | transactional-email-alerts  | Wire transactional email for limit breach alarms | —                     | done — see `context/changes/transactional-email-alerts/` |
| S-05       | email-alarm-on-limit-breach | End-to-end limit breach email alarm (US-01)      | no                    | Wymaga F-04; S-03 + S-04 done                            |

## Open Roadmap Questions

1. **Semantyka okna czasowego limitu** — Czy limit jest liczony w oknie kalendarzowym (np. doba 00:00–24:00), oknie rolling (ostatnie N godzin), czy innym wzorcu? — Owner: user. Block: S-03, S-05 (planowanie z domyślną decyzją dozwolone).
2. **Wykrywanie anomalii vs Non-Goals** — Czy w MVP wystarczy wyłącznie reguła progu (FR-005), czy potrzebna jest prostsza heurystyka anomalii bez ML? — Owner: user. Block: S-05 (no — Non-Goals wykluczają ML w v1).
3. **FR-006 (wiele limitów)** — Nice-to-have: wdrożyć w MVP tylko jeśli starczy czasu po ścieżce must-have, inaczej v2. — Owner: user. Block: roadmap-wide (scope, nie planowanie).

## Parked

- **FR-006: wiele limitów (dzienny + tygodniowy)** — Why parked: nice-to-have; przy `main_goal: speed` i `top_blocker: time` tylko po must-have path.
- **Prognoza rachunku, ceny energii, taryfy** — Why parked: PRD §Non-Goals.
- **Zaawansowane ML i automatyczne wykrywanie przyczyn zużycia** — Why parked: PRD §Non-Goals (w tym anomalie po resecie bezpieczników bez reguły w v1).
- **Wiele gospodarstw, role domowników** — Why parked: PRD §Non-Goals.
- **Powiadomienia push i SMS** — Why parked: PRD §Non-Goals (MVP: tylko email).
- **Integracje poza Tuya / Smart Life** — Why parked: PRD §Non-Goals (Home Assistant, API dostawcy sieci itd.).

## Done

| ID   | Change ID                   | Completed  | Notes                                                                      |
| ---- | --------------------------- | ---------- | -------------------------------------------------------------------------- |
| F-01 | energy-domain-schema        | 2026-05-27 | Tabele domeny energii + RLS                                                |
| F-02 | tuya-read-integration       | 2026-05-30 | OAuth, sync, idempotentne odczyty                                          |
| F-03 | background-limit-evaluation | 2026-05-31 | Cron sync + ewaluacja limitów → `limit_breach_events`                      |
| F-04 | transactional-email-alerts  | 2026-06-02 | Resend client, breach notification job, cron `:10` UTC, retry policy       |
| F-05 | protected-api-routes        | 2026-05-31 | Globalny guard `/api/*` + `requireUser()`                                  |
| S-01 | user-login                  | baseline   | Supabase email/password, signin/signup/signout                             |
| S-02 | tuya-device-and-consumption | 2026-05-31 | North star — Tuya OAuth, licznik, dashboard zużycia                        |
| S-03 | configure-consumption-limit | 2026-06-03 | GET/POST /api/limits, inline dashboard form, window preview + progress bar |
| S-04 | configure-alarm-email       | 2026-06-04 | GET/POST /api/notifications, AlarmEmailForm na dashboardzie                |
