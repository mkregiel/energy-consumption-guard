# Energy Domain Schema — Plan Brief

> Full plan: `context/changes/energy-domain-schema/plan.md`

## What & Why

Dodajemy pierwszy warstwowy model danych w Supabase dla monitora zużycia prądu: liczniki, limit kWh w oknie kalendarzowym, seria odczytów, ustawienia email alarmowy oraz zdarzenia przekroczenia limitu. Bez tego schematu każdy kolejny slice (Tuya, limity, alarm email) utknąłby na ad-hoc storage — to pierwszy techniczny blocker przed north star S-02.

## Starting Point

Repo ma Supabase Auth (`auth.users`) i klient SSR w `src/lib/supabase.ts`, ale **brak** `supabase/migrations/`, `src/types.ts` i jakiejkolwiek warstwy domenowej. README nadal mówi, że migracje nie są potrzebne. Produkcja działa na Cloudflare Workers z zewnętrznym Supabase cloud.

## Desired End State

Po zakończeniu planu istnieje jedna migracja SQL z pięcioma tabelami domenowymi, włączonym RLS (`user_id = auth.uid()`), indeksami pod zapytania F-03, ręcznymi typami w `src/types.ts` oraz zaktualizowaną dokumentacją migracji. Lokalnie `supabase db reset` stosuje schemat bez błędów; RLS weryfikowane ręcznie w Studio. Produkcja: migracja zastosowana po human approval gate.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Limit model | Jeden aktywny limit na użytkownika | Zgodne z FR-003 must-have i modelem 1 user = 1 gospodarstwo | Plan |
| Okno czasowe | Kalendarzowe (day/week/month) + timezone | Naturalne dla domowego monitora; prostsze agregacje niż rolling | Plan |
| Odczyty | Seria czasowa (wiele wierszy per meter) | Historia dla dashboardu i debug alarmów | Plan |
| Breach events | Tabela `limit_breach_events` w tym slice | F-03/F-04 potrzebują idempotentnych eventów i audytu | Plan |
| Pola Tuya na meter | Minimalne (`tuya_device_id`, `tuya_product_id`) | Tokeny OAuth w F-02 — mniejsza powierzchnia bezpieczeństwa teraz | Plan |
| Email alarmowy | Osobna tabela `notification_settings` | FR-004, proste RLS 1:1 z użytkownikiem | Plan |
| Typy TS | Ręczne w `src/types.ts` | Zgodne z AGENTS.md; brak zależności od `gen types` w CI | Plan |
| Scope slice | Schemat + typy + docs (bez serwisów/API) | Czysty foundation; CRUD w F-05 i slice'ach S-* | Plan |

## Scope

**In scope:**

- Jedna migracja SQL w `supabase/migrations/`
- Pięć tabel: `meters`, `consumption_limits`, `consumption_readings`, `notification_settings`, `limit_breach_events`
- RLS na wszystkich tabelach domenowych
- Indeksy pod odczyty czasowe i breach lookup
- Ręczne typy entity/DTO w `src/types.ts`
- Aktualizacja README (sekcja migracji / lokalny dev)

**Out of scope:**

- API routes, serwisy w `src/lib/services/`, UI
- Integracja Tuya (F-02), tokeny OAuth
- Cron job oceny limitów (F-03), wysyłka email (F-04)
- Wiele limitów jednocześnie (FR-006 — v2)
- Seed danych dev, npm scripts `db:push`
- Wygenerowane typy Supabase CLI
- Migracja produkcyjna (human gate — dokumentacja kroków, wykonanie poza `/10x-implement`)

## Architecture / Approach

```
auth.users (existing)
    │
    ├── meters (1 per user, MVP)
    │       └── consumption_readings (time series)
    ├── consumption_limits (1 active per user, calendar window)
    ├── notification_settings (1 alarm email per user)
    └── limit_breach_events (via limit_id + user_id for RLS)
```

Jedna migracja tworzy schemat `public` z FK do `auth.users`, CHECK constraints na enumach okna i progach kWh, oraz politykami RLS izolującymi wiersze per użytkownik. Background job F-03 będzie używał service role (poza RLS użytkownika) — poza tym slice.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Migracja domeny energii | DDL + RLS + indeksy w jednym pliku migracji | RLS na `consumption_readings` przez JOIN z `meters` — test policy dokładnie |
| 2. Typy i dokumentacja | `src/types.ts` + README | Rozjazd typów TS vs SQL — weryfikacja ręczna |
| 3. Weryfikacja lokalna | `supabase db reset` + smoke test RLS | Brak test runnera — tylko manual/Studio |

**Prerequisites:** Supabase CLI (`npx supabase`), lokalny stack lub linked cloud project, istniejący auth baseline.

**Estimated effort:** ~1 sesja implementacji, 3 fazy sekwencyjne.

## Open Risks & Assumptions

- **Jeden licznik per user w MVP** — PRD nie wymaga wielu meterów; schemat używa `UNIQUE(user_id)` na `meters`; rozszerzenie w v2 wymaga migracji.
- **Timezone domyślna** — plan zakłada `Europe/Warsaw` jako default na `consumption_limits`; użytkownik może nadpisać w S-03.
- **Produkcja** — migracja nie cofa się z rollbackiem Workera; wymaga osobnej akceptacji przed `supabase db push` na cloud.
- **Service role dla F-03** — ten slice nie dodaje `SUPABASE_SERVICE_ROLE_KEY`; cron job to osobny change.

## Success Criteria (Summary)

- Migracja stosuje się lokalnie bez błędów (`supabase db reset`)
- RLS blokuje cross-user access (weryfikacja manualna)
- `src/types.ts` odzwierciedla wszystkie tabele i enumy
- README opisuje jak stosować migracje (zastępuje stwierdzenie „brak tabel”)
- Lint i build aplikacji nadal przechodzą (nowy plik typów nie psuje kompilacji)
