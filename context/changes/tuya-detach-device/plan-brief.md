# Dezaktywacja monitoringu metera — Plan Brief

> Full plan: `context/changes/tuya-detach-device/plan.md`
> Frame brief: `context/changes/tuya-detach-device/frame.md`

## What & Why

Brak mechanizmu dezaktywacji cyklu monitoringu metera — użytkownik nie może zasygnalizować systemowi "nie synchronizuj tego licznika", co przy niedostępnym urządzeniu produkuje ciche błędy co godzinę i nie daje kontroli nad stanem monitoringu.

## Starting Point

Tabela `meters` wymaga `tuya_device_id NOT NULL` — meter nie istnieje bez urządzenia. Cron sync (`get_eligible_sync_targets()`) pobiera wszystkie metery z tokenem OAuth i synchronizuje je co godzinę. Brak koncepcji "aktywny/nieaktywny" meter. Ewaluacja limitów ładuje wszystkie metery bez filtrowania.

## Desired End State

Użytkownik może jednym kliknięciem (z potwierdzeniem) dezaktywować monitoring metera. Dashboard pokazuje baner "Monitoring wstrzymany" i ukrywa sekcje sync/odczytów. Cron sync i ewaluacja limitów pomijają nieaktywne metery. Historia odczytów i limity zostają nienaruszone. Reaktywacja przywraca normalny monitoring.

## Key Decisions Made

| Decision               | Choice                                | Why (1 sentence)                                                                                      | Source |
| ---------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------ |
| Mechanizm dezaktywacji | Status field (nie nullable device_id) | tuya_device_id load-bearing w ~18 miejscach; status field wpasowuje się w istniejący skip-pattern RPC | Frame  |
| Zachowanie historii    | Odczyty i limity zachowane            | CASCADE delete wykluczony; limity referencjonują user_id, nie meter_id                                | Frame  |
| Ewaluacja limitów      | Wstrzymana przy inactive              | Brak nowych odczytów = ewaluacja na starych danych = potencjalne fałszywe alarmy                      | Plan   |
| UX dezaktywacji        | Przycisk + dialog potwierdzenia       | Spójne z istniejącym wzorcem UI; chroni przed przypadkowym kliknięciem                                | Plan   |
| Widok inactive         | Baner + ukryte sekcje sync            | Jasny komunikat o stanie; czyste UI bez zbędnych elementów                                            | Plan   |

## Scope

**In scope:**

- Kolumna `status` w tabeli `meters` (active/inactive)
- Aktualizacja RPC sync targets i limit evaluation
- Endpoint PATCH `/api/meters/status`
- UI dezaktywacji/reaktywacji na dashboardzie

**Out of scope:**

- Nullable `tuya_device_id`
- Automatyczna dezaktywacja przy błędach sync
- Powiadomienia email o zmianie statusu
- Zmiana flow rejestracji metera

## Architecture / Approach

Addytywna zmiana: nowa kolumna `status` z `DEFAULT 'active'` w `meters`. RPC `get_eligible_sync_targets()` i query w `limit-evaluation.ts` filtrują po `status = 'active'`. Nowy endpoint PATCH zmienia status. Dashboard warunkowo renderuje sekcje na podstawie `meter.status`.

## Phases at a Glance

| Phase                    | What it delivers                                 | Key risk                                                   |
| ------------------------ | ------------------------------------------------ | ---------------------------------------------------------- |
| 1. Schema, RPC i backend | Kolumna status + filtrowanie w sync i limit eval | Migracja musi być kompatybilna wstecz (DEFAULT rozwiązuje) |
| 2. API endpoint          | PATCH /api/meters/status                         | Minimalne — wzorowane na istniejącym meters API            |
| 3. UI dashboardu         | Przycisk dezaktywacji, baner, warunkowe sekcje   | Dialog potwierdzenia i warunkowe renderowanie w Astro      |

**Prerequisites:** Działająca instancja Supabase (local), istniejący meter z tokenem Tuya
**Estimated effort:** ~1-2 sesje, 3 fazy

## Open Risks & Assumptions

- Zakładamy, że jeden użytkownik = jeden meter (constraint UNIQUE user_id). Jeśli multi-meter w przyszłości, endpoint musi przyjmować meter_id.
- Brak automatycznej dezaktywacji — użytkownik musi sam wiedzieć, że urządzenie jest niedostępne.

## Success Criteria (Summary)

- Dezaktywacja metera zatrzymuje sync (brak błędów `TUYA_READING_UNAVAILABLE` w logach cron)
- Dashboard jasno komunikuje stan monitoringu i pozwala na reaktywację
- Historia odczytów i limity przetrwają cykl dezaktywacja→reaktywacja
