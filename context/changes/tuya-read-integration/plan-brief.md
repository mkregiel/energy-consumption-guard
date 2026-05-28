# Tuya Read Integration — Plan Brief

> Full plan: `context/changes/tuya-read-integration/plan.md`
> Research baseline: `context/foundation/roadmap.md` and `context/foundation/prd.md`

## What & Why

Wdrażamy foundation slice F-02, który daje bezpieczny, read-only odczyt zużycia energii z Tuya / Smart Life dla zalogowanego użytkownika. Celem jest szybkie odcięcie największego ryzyka technicznego w roadmapie: czy dane z licznika da się stabilnie pobrać i zapisać w Supabase bez ingerencji w istniejącą konfigurację Smart Life użytkownika.

## Starting Point

F-01 jest już gotowe: istnieją tabele `meters` i `consumption_readings` z RLS. Brakuje jednak storage tokenów OAuth Tuya, endpointów integracyjnych i warstwy serwisowej Tuya; obecne API to tylko auth routes oparte o redirecty.

## Desired End State

Po zakończeniu F-02 użytkownik może połączyć konto Tuya, uruchomić sync on-demand, a odczyt ląduje w `consumption_readings` bez duplikatów dla tego samego czasu odczytu. Endpointy F-02 mają spójny kontrakt JSON + zod i są gotowe jako backendowa baza pod S-02 (widoczność danych) oraz F-03 (automatyczny background check).

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Linking model | OAuth per user | Najlepiej izoluje dane i trzyma się guardrailu „nie psuć Smart Life” | Plan |
| Scope F-02 | Backend-only foundation | Odcina ryzyko integracji bez rozszerzania zakresu o UI | Plan |
| Sync trigger | On-demand endpoint now, cron later | Zachowuje czysty podział F-02 vs F-03 i daje szybki dowód działania | Plan |
| Idempotency | Unique `meter_id + recorded_at` | Chroni przed duplikatami przy retry i upraszcza downstream logikę limitów | Plan |
| API convention | JSON + zod + HTTP status + `prerender=false` | Zgodne z AGENTS i gotowe pod automatyzację | Plan |
| Tuya client strategy | SDK-first with in-scope HTTP fallback | Pozwala szybko ruszyć, ale nie blokuje delivery przy problemach `workerd` | Plan |

## Scope

**In scope:**

- migracja pod tokeny OAuth Tuya per user,
- idempotencja odczytów w bazie,
- serwis integracyjny Tuya po stronie backendu,
- endpoint callback OAuth i endpoint sync on-demand,
- walidacja kontraktów API i obsługa błędów.

**Out of scope:**

- UI podłączenia i podgląd zużycia (S-02),
- cron/scheduler (F-03),
- limity i alarmy email (F-03/F-04/S-05),
- integracje inne niż Tuya / Smart Life.

## Architecture / Approach

Backend split na trzy warstwy: API routes (`src/pages/api/tuya/*`) -> service (`src/lib/services/tuya-*`) -> persistence (Supabase). OAuth callback zapisuje tokeny per user; sync endpoint używa tokenów do pobrania odczytu i robi idempotentny zapis do `consumption_readings`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Contract & runtime config | Sekrety Tuya + standard API routes (JSON/zod) | Rozjazd nowej konwencji z dotychczasowym stylem auth routes |
| 2. Data model extensions | Token storage + idempotency constraints | Błędna polityka RLS dla tokenów |
| 3. Service & endpoints | OAuth callback + sync now + zapis odczytu | Niekompatybilność SDK Tuya z `workerd` |
| 4. Verification & handoff | Dowód E2E i gotowość do kolejnych slice'ów | Niepełny test manualny z realnym kontem Tuya |

**Prerequisites:** F-01 wdrożone, aktywne konto Tuya/Smart Life do testu, skonfigurowane sekrety runtime.
**Estimated effort:** ~2-3 sesje implementacyjne, 4 fazy sekwencyjne.

## Open Risks & Assumptions

- SDK Tuya może nie działać stabilnie w `workerd`; plan zakłada fallback do klienta HTTP bez zmiany API contract.
- F-02 zakłada jeden licznik per user (zgodnie z bieżącym F-01 i MVP).
- Ochrona `/api/*` jest częściowo zależna od równoległego F-05; F-02 endpointy muszą i tak bronić się lokalnie przez session checks.

## Success Criteria (Summary)

- OAuth per user działa i dane uwierzytelniające są persystowane z poprawnym RLS.
- Sync on-demand zapisuje odczyt do `consumption_readings` i nie duplikuje rekordu przy ponownym wywołaniu.
- Endpointy F-02 zwracają spójny JSON + statusy HTTP zgodnie z walidacją zod.
- Istnieje manualny dowód E2E: link Tuya -> sync -> odczyt w bazie.
