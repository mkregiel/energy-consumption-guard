# Frame Brief: Dezaktywacja monitoringu przy niedostępnym urządzeniu Tuya

> Framing step before /10x-plan. This document captures what is _actually_
> at issue, separated from what was initially assumed.

## Reported Observation

Nie ma możliwości odłączenia urządzenia Tuya od licznika. Gdy urządzenie
fizycznie przestaje być dostępne w gospodarstwie (np. jest gdzie indziej),
użytkownik nie może przerwać monitoringu — licznik wciąż jest powiązany
z urządzeniem, które go nie obsługuje, a użytkownik nie ma zamiennika.

## Initial Framing (preserved)

- **User's stated cause or approach**: Potrzebna jest funkcja "detach device" — odłączenie urządzenia od licznika, żeby przerwać monitoring oparty o dane urządzenie.
- **User's proposed direction**: Dodać możliwość odłączenia urządzenia Tuya, gdy jest niedostępne i nie ma zamiennika.
- **Pre-dispatch narrowing**: Historia odczytów ma zostać zachowana. Limity mają czekać na ponowne podłączenie. Sytuacja raczej jednorazowa.

## Dimension Map

Obserwacja mogłaby być rozwiązana na następujących wymiarach:

1. **Model danych (nullable device)** — uczynić `meters.tuya_device_id` nullable, pozwalając na meter bez urządzenia
2. **Stan licznika (status active/paused)** — dodać kolumnę statusu do metera; sync pomija nieaktywne ← wstępny reframe
3. **~~Usunięcie metera~~** — usunąć rekord metera ← wykluczone (CASCADE kasuje odczyty, użytkownik chce zachować historię)
4. **Zachowanie crona** — obecne zachowanie przy martwym urządzeniu (graceful skip z błędem co godzinę)

## Hypothesis Investigation

| Hypothesis                      | Evidence                                                                                                                                                                                                                                                                                                                     | Verdict                                                          |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| **H1: Nullable tuya_device_id** | ~18 miejsc w kodzie zakłada NOT NULL: typy (`src/types.ts:11,118`), walidacja (`meter-service.ts:20-22`, `useMeterUpsert.ts:31-38`), sync (`tuya-client.ts:328,332,336`), UI (`MeterRegistrationForm.tsx:90-91`), API (`src/pages/api/meters/index.ts:16,71`). Każde wymaga null-guard.                                      | STRONG (inwazyjne)                                               |
| **H2: Status active/paused**    | `get_eligible_sync_targets()` RPC (`migrations/20260531193000:11-21`) to prosty INNER JOIN meters↔tokens — dodanie `WHERE m.status = 'active'` jest naturalnym rozszerzeniem. Brak zmian w sync logic, typach, walidacji device_id. Limit evaluation (`limit-evaluation.ts:82-84`) already handles missing meter gracefully. | STRONG (pasuje naturalnie)                                       |
| **~~H3: Usunięcie metera~~**    | `consumption_readings` ma `ON DELETE CASCADE` na `meter_id` (`migrations/20260527120000:37`). Usunięcie metera kasuje historię.                                                                                                                                                                                              | STRONG (wykluczone — sprzeczne z wymaganiem zachowania historii) |
| **H4: Status quo crona**        | Batch sync (`cron-sync.ts:55-68`) jest fault-tolerant: try-catch per meter, errors counter, kontynuuje. Martwe urządzenie → kaskada fallbacków (`tuya-http.ts:563-600`) → `TUYA_READING_UNAVAILABLE`. Nie crashuje, ale produkuje błędy co godzinę.                                                                          | STRONG (tolerancyjny ale nieoptymalny)                           |

## Narrowing Signals

Sygnały decyzyjne z odpowiedzi użytkownika i badania kodu, które zawęziły przestrzeń hipotez:

- **Zachowanie historii** wykluczyło H3 (usunięcie metera z CASCADE delete).
- **Zachowanie limitów** potwierdziło, że `consumption_limits` referencjonuje `user_id` (nie `meter_id`) — limity przeżywają każdy wariant; limit evaluation skipuje gdy brak nowych odczytów w oknie.
- **Jednorazowość** sugeruje lekkie rozwiązanie (status toggle), nie ciężką restrukturyzację schematu (nullable + 18 null-guards).
- **OAuth per-user** (`tuya_oauth_tokens` jest per-user, nie per-device) — odłączenie urządzenia nie narusza połączenia Tuya. Ponowne podłączenie nowego urządzenia wymaga tylko aktualizacji `tuya_device_id`, nie re-OAuth.

## Cross-System Convention

Istniejący wzorzec w systemie: `get_eligible_sync_targets()` już filtruje metery przez INNER JOIN z `tuya_oauth_tokens` — logika "skip jeśli nie spełnia warunku" jest ustaloną konwencją. Dodanie warunku na status metera jest zgodne z tym wzorcem.

Ewaluacja limitów (`limit-evaluation.ts:46-65`) iteruje per-limit, ładuje meter per user, i gracefully skipuje gdy meter jest null lub brak odczytów — konwencja "brak danych = skip, nie error" jest spójna.

## Reframed (or Confirmed) Problem Statement

> **Rzeczywisty problem do zaplanowania**: Brak mechanizmu dezaktywacji cyklu monitoringu metera — użytkownik nie może zasygnalizować systemowi "nie synchronizuj tego licznika", co przy niedostępnym urządzeniu produkuje ciche błędy co godzinę i nie daje kontroli nad stanem monitoringu.

Użytkownik powiedział "detach device" — sugerując usunięcie referencji do urządzenia. Badanie wykazało, że `tuya_device_id` jest load-bearing w ~18 miejscach kodu (typy, walidacja, sync, UI). Usunięcie go (nullable) rozwiązuje problem ale kosztem inwazyjnej zmiany. Tymczasem rdzeń potrzeby to nie "urządzenie musi zniknąć z metera" lecz "system musi wiedzieć, że nie ma co synchronizować". Referencja do urządzenia jest nieszkodliwa gdy sync ją ignoruje — użytkownik i tak zaktualizuje `tuya_device_id` przy podłączeniu nowego urządzenia.

## Confidence

- **HIGH** — silne dowody z kodu (18 miejsc NOT NULL vs naturalny fit statusu w RPC), potwierdzone konwencją systemową (skip-pattern), jednoznaczne odpowiedzi użytkownika (zachować historię + limity).

## What Changes for /10x-plan

Plan powinien skupić się na dodaniu stanu aktywności metera (nie na nullable device_id). Kluczowe punkty: migracja dodająca status do `meters`, aktualizacja `get_eligible_sync_targets()` RPC, endpoint API do zmiany statusu, element UI na dashboardzie do dezaktywacji/reaktywacji. Logika sync, typów i walidacji device_id pozostaje nietknięta.

## References

- Schema: `supabase/migrations/20260527120000_energy_domain_schema.sql:8-17`
- Sync targets RPC: `supabase/migrations/20260531193000_limit_breach_events_window_start_unique.sql:11-21`
- Meter service: `src/lib/services/meter-service.ts:1-44`
- Cron sync batch: `src/lib/services/cron-sync.ts:55-68`
- Device consumption fallbacks: `src/lib/services/tuya-http.ts:563-600`
- Limit evaluation (meter null handling): `src/lib/services/limit-evaluation.ts:77-84`
- Meter type definition: `src/types.ts:11,118`
- OAuth tokens (per-user): `supabase/migrations/20260528120000_tuya_oauth_tokens_and_readings_idempotency.sql:7-18`
