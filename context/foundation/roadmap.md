---
project: Monitor zużycia prądu w gospodarstwie domowym
version: 1
status: draft
created: 2026-05-25
updated: 2026-05-25
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

**S-02: Podłączenie licznika Tuya i widoczność zużycia** — Najwcześniejszy dowód, że dane z licznika realnie trafiają do aplikacji (wybór: najpierw widoczność zużycia, potem limity i alarm). Zgodne z `main_goal: speed` — odcięcie największego ryzyka integracji Tuya przed budową pełnego US-01.

> **Gwiazda przewodnia** — najmniejszy przepływ end-to-end, który potwierdza, że produkt „żyje” (tu: połączenie licznika i odczyt zużycia). Reszta roadmapy ma sens dopiero, gdy ten krok działa; umieszczony jak najwcześniej po spełnieniu Prerequisites.

## At a glance

| ID | Change ID | Outcome (user can …) | Prerequisites | PRD refs | Status |
|---|---|---|---|---|---|
| F-01 | energy-domain-schema | (foundation) persist meters, limits, and consumption readings in Supabase | — | NFR (background), Business Logic | proposed |
| F-02 | tuya-read-integration | (foundation) read consumption from Tuya / Smart Life without altering user’s platform setup | F-01 | FR-002, Guardrails | proposed |
| F-03 | background-limit-evaluation | (foundation) periodic job compares stored consumption against configured limits | F-01 | NFR (background), FR-005 | proposed |
| F-04 | transactional-email-alerts | (foundation) send alarm emails to a configured address on limit breach | F-01 | FR-004, FR-005, US-01 | proposed |
| F-05 | protected-api-routes | (foundation) authenticated API routes for device, limit, and notification configuration | — | FR-001, Access Control | proposed |
| S-01 | user-login | log in with email and password | — | FR-001, US-01 | ready |
| S-02 | tuya-device-and-consumption | connect an energy meter via Tuya / Smart Life and see current consumption in the app | F-01, F-02, F-05, S-01 | FR-002, US-01 | proposed |
| S-03 | configure-consumption-limit | set an energy limit (kWh) within a configured time window | S-02, F-01, F-05 | FR-003, US-01 | proposed |
| S-04 | configure-alarm-email | set the email address used for alarm notifications | S-01, F-01, F-05 | FR-004, US-01 | proposed |
| S-05 | email-alarm-on-limit-breach | receive an email when consumption in the configured window exceeds the limit | S-02, S-03, S-04, F-03, F-04 | FR-005, US-01 | proposed |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme | Chain | Note |
|---|---|---|---|
| A | Dane i Tuya | `F-01` → `F-02` → `S-02` | Gwiazda przewodnia; `speed` — najpierw odcięcie ryzyka integracji i zapisu odczytów. |
| B | Alarm w tle | `F-03` / `F-04` (parallel) → `S-05` | Dołącza do Stream A po `S-03` + `S-04`; job i email równolegle po `F-01`. |
| C | Konfiguracja limitów | `S-03` | Po `S-02`; równolegle z `S-04` (Stream D). |
| D | Konto i powiadomienia | `F-05` → `S-01` → `S-04` | Auth w baseline — `S-01` gotowy; `S-04` równolegle z `S-03`. |

## Baseline

What's already in place in the codebase as of `2026-05-25` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** partial — Astro 6 + React islands, Tailwind, shadcn scaffold (`astro.config.mjs`, `src/components/ui/button.tsx`)
- **Backend / API:** partial — Astro SSR + Cloudflare; auth API routes only (`src/pages/api/auth/`, `src/middleware.ts`)
- **Data:** partial — `@supabase/supabase-js` client (`src/lib/supabase.ts`); brak `supabase/migrations/` w repo
- **Auth:** present — Supabase email/password; session via cookies (`src/lib/supabase.ts`, `src/middleware.ts`); guard tylko na `/dashboard` (partial na `/api/*`)
- **Deploy / infra:** present — per tech-stack.md: Cloudflare Pages, GitHub Actions CI/deploy (`.github/workflows/ci.yml`, `wrangler.jsonc`)
- **Observability:** partial — `wrangler.jsonc` observability; brak Sentry/Datadog w kodzie aplikacji

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
- **Status:** proposed

### F-02: Tuya read integration

- **Outcome:** (foundation) server can pull consumption from a user-linked Tuya / Smart Life device read-only, respecting Guardrails (no disruption to existing Smart Life setup).
- **Change ID:** tuya-read-integration
- **PRD refs:** FR-002, Guardrails (Tuya / Smart Life)
- **Unlocks:** S-02 (north star), S-05
- **Prerequisites:** F-01
- **Parallel with:** F-05
- **Blockers:** —
- **Unknowns:**
  - Jakie uprawnienia / flow OAuth Tuya są wymagane dla licznika energii użytkownika? — Owner: user. Block: no.
- **Risk:** Integracja poza starterem (tech-stack.md); największe ryzyko czasowe — dlatego north star celuje w ten slice przed alarmem email.
- **Status:** proposed

### F-03: Background limit evaluation

- **Outcome:** (foundation) scheduled worker periodically loads consumption, evaluates limits, and emits breach events (no email yet).
- **Change ID:** background-limit-evaluation
- **PRD refs:** NFR (background), FR-005
- **Unlocks:** S-05
- **Prerequisites:** F-01
- **Parallel with:** F-04, F-02
- **Blockers:** —
- **Unknowns:**
  - Gdzie uruchomić cron/worker przy deploy na Cloudflare (Workers cron vs external)? — Owner: team. Block: no.
- **Risk:** FR-005 wymaga działania bez użytkownika — bez joba S-05 to tylko UI, nie produkt.
- **Status:** proposed

### F-04: Transactional email alerts

- **Outcome:** (foundation) application can send a templated alarm email to a stored address when a breach event fires.
- **Change ID:** transactional-email-alerts
- **PRD refs:** FR-004, FR-005, US-01
- **Unlocks:** S-05
- **Prerequisites:** F-01
- **Parallel with:** F-03, F-02
- **Blockers:** —
- **Unknowns:**
  - Który dostawca email (Resend, SendGrid, Supabase Edge, inny) i limity darmowego tieru? — Owner: user. Block: no.
- **Risk:** Ostatni element US-01 — sekwencjonowany po Tuya i konfiguracji, żeby nie budować emaili przed dowodem danych z licznika.
- **Status:** proposed

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
- **Status:** proposed

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
- **Status:** ready

### S-02: Tuya device and consumption visibility

- **Outcome:** user can connect an energy meter via Tuya / Smart Life and see consumption data in the app (north star).
- **Change ID:** tuya-device-and-consumption
- **PRD refs:** FR-002, US-01
- **Prerequisites:** F-01, F-02, F-05, S-01
- **Parallel with:** —
- **Blockers:** —
- **Unknowns:**
  - Czy w MVP wystarczy ostatni odczyt / suma w oknie, czy wykres historyczny? — Owner: user. Block: no.
- **Risk:** Dowód hipotezy produktu — bez tego limity i email nie mają źródła prawdy; `top_blocker: time` sugeruje nie rozszerzać UI poza must-have.
- **Status:** proposed

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
- **Status:** proposed

### S-04: Configure alarm email

- **Outcome:** user can set the email address that receives alarm notifications.
- **Change ID:** configure-alarm-email
- **PRD refs:** FR-004, US-01
- **Prerequisites:** S-01, F-01, F-05
- **Parallel with:** S-03
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Prosty CRUD — równoległy ze S-03 po north star, żeby skrócić ścieżkę do US-01.
- **Status:** proposed

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

| Roadmap ID | Change ID | Suggested issue title | Ready for `/10x-plan` | Notes |
|---|---|---|---|---|
| F-01 | energy-domain-schema | Add Supabase schema for meters, limits, and readings | no | Odblokowuje north star S-02 |
| F-02 | tuya-read-integration | Integrate Tuya / Smart Life read-only consumption API | no | Wymaga F-01 |
| F-03 | background-limit-evaluation | Add scheduled consumption vs limit evaluation job | no | Wymaga F-01 |
| F-04 | transactional-email-alerts | Wire transactional email for limit breach alarms | no | Wymaga F-01 |
| F-05 | protected-api-routes | Extend session guard to configuration API routes | no | Równolegle z F-01 |
| S-01 | user-login | Verify and polish login flow for MVP | yes | Baseline auth present |
| S-02 | tuya-device-and-consumption | Connect Tuya meter and show consumption in app | no | North star; wymaga F-01, F-02, F-05 |
| S-03 | configure-consumption-limit | UI and API to set kWh limit in a time window | no | Wymaga S-02 |
| S-04 | configure-alarm-email | UI and API to set alarm notification email | no | Wymaga F-01, F-05 |
| S-05 | email-alarm-on-limit-breach | End-to-end limit breach email alarm (US-01) | no | Wymaga S-02–S-04, F-03, F-04 |

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
