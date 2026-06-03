# Configure Consumption Limit — Plan Brief

> Full plan: `context/changes/configure-consumption-limit/plan.md`

## What & Why

Użytkownik musi ustawić próg zużycia energii (kWh) w wybranym oknie czasowym (FR-003), aby ścieżka US-01 mogła działać: F-03 już porównuje odczyty z limitem w tle, ale bez S-03 limit trzeba wstawiać ręcznie w Supabase Studio.

## Starting Point

Schemat `consumption_limits` (jeden limit na użytkownika, `window_type` day/week/month, domyślna strefa `Europe/Warsaw`) i typy w `src/types.ts` istnieją od F-01. F-03 (`limit-evaluation.ts`, `consumption-window.ts`) liczy sumę `kwh_delta` w **oknie kalendarzowym** i zapisuje `limit_breach_events`. Dashboard ma licznik i zużycie (S-02), ale brak `/api/limits`, serwisu limitów i UI. RPC `sum_meter_consumption_in_window` jest dostępne tylko dla `service_role`.

## Desired End State

Zalogowany użytkownik na `/dashboard` ustawia lub zmienia limit (próg kWh + okno: dzień/tydzień/miesiąc) przez inline formularz; po zapisie widzi krótki komunikat sukcesu bez przeładowania strony. Sekcja limitu jest widoczna także bez zarejestrowanego licznika. Gdy jest licznik i limit, widać sumę zużycia w bieżącym oknie oraz pasek postępu względem progu — obliczenia zgodne z F-03. `GET/POST /api/limits` chronione jak `/api/meters`.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Semantyka okna | Kalendarzowe day/week/month | Spójność z `getWindowBounds` i jobem F-03 — unika fałszywych alarmów przez rozjazd definicji | Plan |
| Strefa czasowa | Ukryta, `Europe/Warsaw` | Prostszy MVP; pole w DB na przyszłość bez ekspozycji w UI | Plan |
| Widoczność UI | Formularz zawsze na dashboardzie | Użytkownik może skonfigurować limit przed licznikiem (ścieżka US-01) | Plan |
| Podgląd zużycia | Suma w oknie + pasek postępu | Użytkownik widzi zbliżanie się do progu bez czekania na email | Plan |
| Tryb edycji | Inline (bez osobnego podglądu) | Mniej kliknięć niż wzorzec view/edit licznika | Plan |
| Po zapisie | Komunikat sukcesu, bez reload | Szybsza iteracja; stan formularza aktualizowany lokalnie | Plan |
| Usuwanie limitu | Tylko upsert, brak DELETE | FR-003 wymaga dodania limitu; CHECK `threshold_kwh > 0` | Plan |
| Agregacja w UI | Suma przez RLS + `getWindowBounds` | RPC F-03 bez grantu dla `authenticated` i bez luki ownership | Plan |
| Ścieżka API | `GET/POST /api/limits` | Zgodne z F-05 (`/api/limits/*`) i wzorcem `meters/index.ts` | Plan |

## Scope

**In scope:**

- `src/pages/api/limits/index.ts` — GET (limit lub null), POST (upsert)
- `src/lib/services/limit-service.ts` — `getUserLimit`, `upsertUserLimit`
- `src/lib/services/limit-consumption-preview.ts` (lub równoważny helper) — suma `kwh_delta` w oknie dla licznika użytkownika
- Typy `LimitUpsertPayload`, etykiety okien w UI
- `ConsumptionLimitForm` + hook `useLimitUpsert` + inline success message
- Sekcja na `dashboard.astro` (SSR limitu + opcjonalnie podgląd zużycia)
- Pasek postępu vs `threshold_kwh`

**Out of scope:**

- Email alarmowy (S-04), wysyłka breach (S-05), F-04
- Wiele limitów (FR-006), DELETE limitu
- Wybór strefy czasowej w UI
- Okna rolling
- Migracja SQL (schemat wystarcza; ewentualny grant RPC — odrzucony na rzecz RLS sum)
- Test runner / nowa infrastruktura testów

## Architecture / Approach

```
dashboard.astro (SSR)
  → getUserLimit, getUserMeter
  → getLimitWindowPreview(meter, limit)  // getWindowBounds + sum readings (RLS)
  → ConsumptionLimitForm (client:load)

POST /api/limits → requireUser → zod → upsertUserLimit → apiJsonSuccess
GET  /api/limits → requireUser → getUserLimit

F-03 cron (unchanged) reads same consumption_limits + getWindowBounds semantics
```

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. API & service | `/api/limits`, limit-service, typy | Walidacja `threshold_kwh` musi być spójna z CHECK w DB |
| 2. Window preview | Helper sumy w oknie dla dashboardu | Brak licznika → pasek ukryty; puste okno → 0 kWh |
| 3. Limit UI | Inline form, hook, success banner | Brak biblioteki toast — prosty banner w komponencie |
| 4. Dashboard wiring | SSR + kolejność sekcji | Rozmiar `dashboard.astro` — trzymać sekcje modularnie |

**Prerequisites:** S-02, F-01, F-05 zaimplementowane; lokalny Supabase z migracjami.

**Estimated effort:** ~2 sesje implementacji, 4 fazy sekwencyjne.

## Open Risks & Assumptions

- Podgląd zużycia wymaga licznika i odczytów w oknie — bez danych pasek pokazuje 0 lub stan „brak odczytów”.
- `kwh_delta` NULL traktowane jak 0 (jak F-03).
- Inline success zamiast toast library — pierwszy wzorzec w repo; S-04 może reużyć.
- Tydzień = poniedziałek 00:00 w `Europe/Warsaw` (jak `consumption-window.ts`).

## Success Criteria (Summary)

- Użytkownik zapisuje limit przez UI; rekord w `consumption_limits` widoczny po odświeżeniu i w GET API.
- Podgląd sumy i pasek zgadzają się z oceną F-03 dla tego samego limitu i odczytów.
- `npm run lint` i `npm run build` przechodzą; niezalogowany `GET /api/limits` → 401 JSON.
