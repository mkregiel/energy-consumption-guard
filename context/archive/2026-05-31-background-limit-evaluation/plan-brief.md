# Background Limit Evaluation — Plan Brief

> Full plan: `context/changes/background-limit-evaluation/plan.md`

## What & Why

Dodajemy okresowe joby w tle (Cloudflare Cron Triggers), które — bez interwencji użytkownika — synchronizują odczyty Tuya (opcjonalny cron) i porównują zużycie energii ze skonfigurowanym limitem kWh w oknie kalendarzowym. Przy przekroczeniu zapisują zdarzenie `limit_breach_events`. To warstwa foundation pod FR-005 / US-01; wysyłka email pozostaje w F-04.

## Starting Point

F-01 dostarcza schemat (`consumption_limits`, `consumption_readings`, `limit_breach_events`) i typy w `src/types.ts`. F-02 dostarcza on-demand sync (`POST /api/tuya/sync`, `syncMeterReading` w `tuya-client.ts`). Brak: cron w `wrangler.jsonc`, `SUPABASE_SERVICE_ROLE_KEY`, serwisu oceny limitów, tras `/api/cron/*`, batch sync bez sesji użytkownika.

## Desired End State

Co godzinę UTC Cloudflare uruchamia dwa joby: (1) batch sync odczytów Tuya dla użytkowników z podłączonym licznikiem, (2) ocena limitów z sumy `kwh_delta` w bieżącym oknie (day/week/month + timezone). Przekroczenie tworzy co najwyżej jeden breach event na limit na okno. Joby zwracają JSON podsumowanie; operacje widać w `wrangler tail`. F-04 może czytać niewysłane eventy (`notified_at IS NULL`).

## Key Decisions Made

| Decision            | Choice                                  | Why (1 sentence)                                               | Source  |
| ------------------- | --------------------------------------- | -------------------------------------------------------------- | ------- |
| Scope jobów         | Dwa osobne crony: sync + ocena          | Izolacja timeoutów Tuya od szybkiej oceny limitów              | Plan    |
| Harmonogram         | Co godzinę UTC (`0` sync, `5` evaluate) | Zgodne z deploy-plan; evaluate 5 min po sync                   | Plan    |
| Agregacja zużycia   | Suma `kwh_delta` w oknie kalendarzowym  | Odzwierciedla przyrost w oknie; `kwh_cumulative` służy do sync | Plan    |
| Idempotencja breach | Max 1 event na `(limit_id, okno)`       | Unika spamu przed F-04; lookup `breached_at >= window_start`   | Plan    |
| Ponowny breach      | Dopiero w następnym oknie               | Naturalnie wynika z idempotencji per okno                      | Plan    |
| Auth cron HTTP      | `Authorization: Bearer CRON_SECRET`     | Ręczne testy i fallback bez polegania wyłącznie na CF          | Plan    |
| Batch DB access     | `SUPABASE_SERVICE_ROLE_KEY`             | Job musi iterować wszystkich użytkowników poza RLS sesji       | Plan    |
| Brak odczytów       | Pomiń użytkownika, log w JSON response  | Nie failuj całego joba przez jednego usera bez danych          | Plan    |
| Logowanie jobów     | JSON response + `wrangler tail`         | Prosto na MVP; bez nowej tabeli                                | Plan    |
| Email / UI limitów  | Out of scope                            | F-04, S-03, S-05                                               | Roadmap |

## Scope

**In scope:**

- `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` w env schema + `.env.example`
- Service role Supabase client (`src/lib/supabase-service-role.ts`)
- Serwis oceny limitów + helper okien czasowych
- Serwis batch sync Tuya (reuse `syncMeterReading`)
- Trasy `POST /api/cron/sync-readings`, `POST /api/cron/evaluate-limits`
- `triggers.crons` w `wrangler.jsonc` + scheduled dispatcher
- Runbook w README (manual trigger, prod secrets)

**Out of scope:**

- Wysyłka email (F-04), UI/API konfiguracji limitów (S-03)
- End-to-end US-01 alarm (S-05)
- Wiele limitów na użytkownika (FR-006)
- Tabela `job_runs`, Sentry/Datadog
- Middleware guard na `/api/*` (F-05 — osobny slice)
- Migracje SQL (schemat F-01 wystarcza)

## Architecture / Approach

```
Cloudflare Cron (0 * * * *) ──► scheduled dispatcher ──► runBatchTuyaSync()
Cloudflare Cron (5 * * * *) ──► scheduled dispatcher ──► runLimitEvaluation()
                                      │
Manual curl + CRON_SECRET ──► POST /api/cron/* ──────────┘
                                      │
                              service role Supabase
                                      │
                    consumption_readings / consumption_limits
                                      │
                              limit_breach_events (insert)
```

Dispatcher wywołuje te same funkcje serwisowe co trasy HTTP (bez self-fetch). Trasy HTTP służą do ręcznej weryfikacji i fallbacku (GitHub Actions cron → HTTP).

## Phases at a Glance

| Phase                     | What it delivers                                | Key risk                                       |
| ------------------------- | ----------------------------------------------- | ---------------------------------------------- |
| 1. Cron infrastructure    | Service role client, CRON_SECRET auth, env docs | Service role key w prod wymaga human approval  |
| 2. Limit evaluation       | Window math, breach insert, evaluate route      | Timezone/week boundaries edge cases            |
| 3. Batch Tuya sync        | Iteracja userów, sync route                     | Tuya timeout przy wielu użytkownikach          |
| 4. Wrangler crons         | Dwa triggery + scheduled dispatcher             | Astro custom `scheduled` export wiring         |
| 5. Verification & handoff | Manual runbook, JSON contract dla F-04          | Brak seed limitów w UI — test przez SQL/Studio |

**Prerequisites:** F-01 implemented; F-02 implemented (dla sync cron); lokalny Supabase z migracjami.

**Estimated effort:** ~2–3 sesje implementacji across 5 faz.

## Open Risks & Assumations

- S-03 (UI limitów) nie istnieje — testy wymagają ręcznego INSERT do `consumption_limits` w Studio.
- `kwh_delta` może być NULL dla pierwszego odczytu — suma traktuje NULL jako 0.
- Tuya batch sync może przekroczyć CPU/time limit Workera przy wielu użytkownikach — MVP zakłada małą liczbę kont.
- Okno `week` = ISO tydzień (poniedziałek 00:00 w timezone limitu) — spójne z typowym rozliczeniem tygodniowym.

## Success Criteria (Summary)

- Cron evaluate tworzy `limit_breach_events` gdy suma `kwh_delta` w oknie > `threshold_kwh`, max raz na okno.
- Cron sync zapisuje nowe odczyty dla użytkowników z meter + Tuya token bez sesji.
- Oba joby zwracają JSON z licznikami (processed/skipped/breached/errors); `npm run lint` i `npm run build` przechodzą.
- F-04 ma gotowy kontrakt: SELECT breach events WHERE `notified_at IS NULL`.
