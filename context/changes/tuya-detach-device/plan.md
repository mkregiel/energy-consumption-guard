# Dezaktywacja monitoringu metera — Implementation Plan

## Overview

Dodanie stanu aktywności (`status`) do tabeli `meters`, pozwalającego użytkownikowi wstrzymać monitoring zużycia energii gdy urządzenie Tuya jest niedostępne. Sync i ewaluacja limitów pomijają nieaktywne metery. Dashboard pokazuje stan monitoringu i pozwala na dezaktywację/reaktywację.

## Current State Analysis

System wymaga `tuya_device_id NOT NULL` w tabeli `meters` — meter nie istnieje bez urządzenia. Gdy urządzenie jest fizycznie niedostępne, cron sync co godzinę próbuje synchronizować i produkuje błędy `TUYA_READING_UNAVAILABLE`. Użytkownik nie ma żadnej kontroli nad tym zachowaniem.

### Key Discoveries:

- `get_eligible_sync_targets()` RPC (`migrations/20260531193000:11-21`) to INNER JOIN meters↔tokens — dodanie `WHERE m.status = 'active'` jest naturalnym rozszerzeniem istniejącego skip-patternu
- `limit-evaluation.ts:82-84` already handles `meter: null` → "skipped" — wystarczy przefiltrować nieaktywne metery w query, a istniejąca logika null-handling zrobi resztę
- `MeterRegistrationForm.tsx` ma tryb display (meter zarejestrowany, nie edytowany) z przyciskiem "Zmień urządzenie" — naturalny punkt na przycisk dezaktywacji
- `SyncConsumptionButton` ma prop `disabled` — gotowy do wyłączenia przy nieaktywnym meterze
- `consumption_limits` referencjonuje `user_id` (nie `meter_id`) — limity przeżywają zmianę statusu metera

## Desired End State

Użytkownik widzi na dashboardzie stan swojego metera (aktywny/nieaktywny). Może jednym kliknięciem (z potwierdzeniem) dezaktywować monitoring — cron sync i ewaluacja limitów przestają działać dla tego metera. Historia odczytów i konfiguracja limitów zostają nienaruszone. Użytkownik może reaktywować meter w dowolnym momencie, a monitoring wznawia się automatycznie.

Weryfikacja: po dezaktywacji metera, następny cykl cron-sync pomija tego metera (brak `TUYA_READING_UNAVAILABLE` w logach). Dashboard pokazuje baner "Monitoring wstrzymany" z przyciskiem reaktywacji. Po reaktywacji sync i ewaluacja limitów wracają do normy.

## What We're NOT Doing

- Nullable `tuya_device_id` — frame wykluczył (inwazyjne, ~18 null-guards)
- Usuwanie metera — CASCADE kasuje odczyty
- Automatyczna dezaktywacja przy wykryciu błędów sync — to byłby osobny change
- Zmiana flow rejestracji metera — istniejący upsert działa bez zmian
- Powiadomienie email o dezaktywacji/reaktywacji — poza scope MVP

## Implementation Approach

Dodanie kolumny `status TEXT NOT NULL DEFAULT 'active'` do `meters` z CHECK constraint na `('active', 'inactive')`. Aktualizacja RPC `get_eligible_sync_targets()` i query w `limit-evaluation.ts` żeby filtrować po statusie. Nowy endpoint PATCH `/api/meters/status` do zmiany statusu. Kontrolka w `MeterRegistrationForm` z dialogiem potwierdzenia + warunkowe renderowanie sekcji dashboardu.

---

## Phase 1: Schema, RPC i logika backendowa

### Overview

Migracja dodająca kolumnę `status` do `meters`, aktualizacja RPC sync targets i filtrowanie w limit evaluation. Po tej fazie backend poprawnie pomija nieaktywne metery.

### Changes Required:

#### 1. Migracja bazy danych

**File**: `supabase/migrations/20260628120000_meter_status.sql`

**Intent**: Dodać kolumnę `status` do tabeli `meters` z wartością domyślną `'active'` i CHECK constraint. Zaktualizować RPC `get_eligible_sync_targets()` żeby pomijała nieaktywne metery.

**Contract**: Migracja dodaje kolumnę `status TEXT NOT NULL DEFAULT 'active'` z `CHECK (status IN ('active', 'inactive'))` do `public.meters`. Następnie `CREATE OR REPLACE FUNCTION public.get_eligible_sync_targets()` z dodanym warunkiem `WHERE m.status = 'active'` w JOINie.

#### 2. Typ Meter

**File**: `src/types.ts`

**Intent**: Rozszerzyć interfejs `Meter` o pole `status`.

**Contract**: Dodać `status: 'active' | 'inactive'` do interfejsu `Meter` (linia ~11).

#### 3. Filtrowanie w limit evaluation

**File**: `src/lib/services/limit-evaluation.ts`

**Intent**: Filtrować nieaktywne metery w `loadMetersByUserId` żeby ewaluacja limitów je pomijała. Istniejący null-handling (`evaluateLimit` linia 82-84) automatycznie zwróci "skipped" dla użytkowników z nieaktywnym meterem.

**Contract**: Dodać `.eq("status", "active")` do query w `loadMetersByUserId` (linia ~20).

### Success Criteria:

#### Automated Verification:

- Migracja aplikuje się czysto: `npx supabase db reset`
- Typ `Meter` zawiera pole `status`
- Typecheck przechodzi: `npm run typecheck`

#### Manual Verification:

- W Supabase Studio: tabela `meters` ma kolumnę `status` z domyślną wartością `'active'`
- RPC `get_eligible_sync_targets()` pomija metery ze statusem `'inactive'`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: API endpoint do zmiany statusu

### Overview

Endpoint PATCH `/api/meters/status` pozwalający zalogowanemu użytkownikowi zmienić status swojego metera. Serwis `meter-service.ts` dostaje nową funkcję.

### Changes Required:

#### 1. Serwis zmiany statusu

**File**: `src/lib/services/meter-service.ts`

**Intent**: Dodać funkcję `updateMeterStatus` aktualizującą kolumnę `status` metera danego użytkownika.

**Contract**: `updateMeterStatus(supabase, userId, status: 'active' | 'inactive'): Promise<Meter>`. Aktualizuje wiersz w `meters` po `user_id`, zwraca zaktualizowany meter. Rzuca `TuyaServiceError` gdy meter nie istnieje (`TUYA_METER_NOT_FOUND`, 404) lub update się nie powiedzie.

#### 2. Endpoint API

**File**: `src/pages/api/meters/status.ts`

**Intent**: Nowy endpoint PATCH obsługujący zmianę statusu metera. Wzorowany na istniejącym `src/pages/api/meters/index.ts`.

**Contract**: `export const PATCH: APIRoute`. Zod schema waliduje `{ status: z.enum(['active', 'inactive']) }`. Auth via `requireUser(locals)`. Wywołuje `updateMeterStatus()`. Zwraca `apiJsonSuccess(200, { meter })`.

### Success Criteria:

#### Automated Verification:

- Typecheck przechodzi: `npm run typecheck`
- Linting przechodzi: `npm run lint`

#### Manual Verification:

- PATCH `/api/meters/status` z `{ "status": "inactive" }` zwraca 200 i zaktualizowany meter
- PATCH bez auth zwraca 401
- PATCH z nieprawidłowym statusem zwraca 400

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: UI dashboardu

### Overview

Kontrolka dezaktywacji/reaktywacji w `MeterRegistrationForm`, baner "monitoring wstrzymany" na dashboardzie, warunkowe ukrycie sekcji sync i odczytów.

### Changes Required:

#### 1. Hook do zmiany statusu metera

**File**: `src/components/hooks/useMeterStatus.ts` (nowy)

**Intent**: Custom hook React do wywołania PATCH `/api/meters/status`. Wzorowany na istniejącym `useTuyaSync.ts`.

**Contract**: `useMeterStatus()` zwraca `{ updateStatus, isLoading, error }`. `updateStatus(status: 'active' | 'inactive')` wywołuje endpoint i odświeża stronę po sukcesie (pattern: `window.location.reload()` jak w istniejących hookach).

#### 2. Kontrolka dezaktywacji w formularzu metera

**File**: `src/components/tuya/MeterRegistrationForm.tsx`

**Intent**: Dodać przycisk "Dezaktywuj" / "Reaktywuj" w trybie display (meter zarejestrowany, nie edytowany). Przycisk dezaktywacji otwiera dialog potwierdzenia. Komponent musi przyjmować `meter.status` (już dostępne przez prop `meter: Meter`).

**Contract**: W sekcji display mode (linia ~78-115) dodać przycisk obok istniejącego "Zmień urządzenie". Gdy `meter.status === 'active'`: przycisk "Dezaktywuj monitoring" (amber/red). Gdy `meter.status === 'inactive'`: przycisk "Reaktywuj monitoring" (emerald). Dialog potwierdzenia przed dezaktywacją z tekstem wyjaśniającym skutki.

#### 3. Warunkowe renderowanie sekcji dashboardu

**File**: `src/pages/dashboard.astro`

**Intent**: Gdy meter jest nieaktywny, pokazać baner "Monitoring wstrzymany" i ukryć sekcje ConsumptionHero, ConsumptionReadingsTable, SyncConsumptionButton. Zachować widoczność MeterRegistrationForm (żeby użytkownik mógł reaktywować).

**Contract**: Dodać warunek `meter.status === 'active'` do istniejącego bloku warunkowego wyświetlającego sekcję consumption (linia ~83). Gdy inactive: renderować baner informacyjny zamiast sekcji consumption.

### Success Criteria:

#### Automated Verification:

- Typecheck przechodzi: `npm run typecheck`
- Linting przechodzi: `npm run lint`
- Istniejące testy E2E przechodzą: `npx playwright test`

#### Manual Verification:

- Dashboard z aktywnym meterem wygląda jak dotychczas (brak regresji)
- Kliknięcie "Dezaktywuj" otwiera dialog potwierdzenia
- Po potwierdzeniu: meter status zmienia się na inactive, sekcja consumption znika, pojawia się baner
- Kliknięcie "Reaktywuj" przywraca normalny widok
- Sync button jest wyłączony/ukryty przy nieaktywnym meterze

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `updateMeterStatus` — happy path (active→inactive, inactive→active), meter not found, DB error
- Zod validation w endpoint — prawidłowy i nieprawidłowy status

### Integration Tests:

- Cron sync pomija inactive metery (via `get_eligible_sync_targets()`)
- Limit evaluation pomija inactive metery

### Manual Testing Steps:

1. Zarejestruj meter, zweryfikuj że status = active
2. Dezaktywuj meter, sprawdź dashboard (baner, ukryte sekcje)
3. Poczekaj na cykl cron — sprawdź że inactive meter nie generuje błędów sync
4. Reaktywuj meter, sprawdź że sync wraca do normy
5. Zweryfikuj że historia odczytów i limity przetrwały cykl dezaktywacja→reaktywacja

## Performance Considerations

Brak istotnego wpływu. Dodanie `WHERE status = 'active'` do RPC nie wymaga indeksu — tabela `meters` ma constraint `UNIQUE(user_id)`, więc per-user lookup jest O(1). Przy jednym użytkowniku (MVP) performance jest irrelevant.

## Migration Notes

Migracja jest addytywna — `DEFAULT 'active'` oznacza, że istniejące metery automatycznie stają się aktywne. Brak breaking changes. Rollback: `ALTER TABLE meters DROP COLUMN status` + przywrócenie starego RPC.

## References

- Frame brief: `context/changes/tuya-detach-device/frame.md`
- Schema: `supabase/migrations/20260527120000_energy_domain_schema.sql:8-17`
- Sync targets RPC: `supabase/migrations/20260531193000_limit_breach_events_window_start_unique.sql:11-21`
- Meter service: `src/lib/services/meter-service.ts`
- Limit evaluation: `src/lib/services/limit-evaluation.ts:15-27, 77-84`
- Meter type: `src/types.ts:7-15`
- Dashboard: `src/pages/dashboard.astro`
- Meter form: `src/components/tuya/MeterRegistrationForm.tsx`
- Sync button: `src/components/consumption/SyncConsumptionButton.tsx`
- API meters: `src/pages/api/meters/index.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema, RPC i logika backendowa

#### Automated

- [x] 1.1 Migracja aplikuje się czysto — 8ec36aa
- [x] 1.2 Typ Meter zawiera pole status — 8ec36aa
- [x] 1.3 Typecheck przechodzi — 8ec36aa

#### Manual

- [ ] 1.4 Kolumna status widoczna w Supabase Studio z domyślną wartością active
- [ ] 1.5 RPC get_eligible_sync_targets() pomija inactive metery

### Phase 2: API endpoint do zmiany statusu

#### Automated

- [x] 2.1 Typecheck przechodzi — 20c1363
- [x] 2.2 Linting przechodzi — 20c1363

#### Manual

- [ ] 2.3 PATCH /api/meters/status z valid payload zwraca 200
- [ ] 2.4 PATCH bez auth zwraca 401
- [ ] 2.5 PATCH z nieprawidłowym statusem zwraca 400

### Phase 3: UI dashboardu

#### Automated

- [x] 3.1 Typecheck przechodzi — 99ac456
- [x] 3.2 Linting przechodzi — 99ac456
- [x] 3.3 Istniejące testy E2E przechodzą — 99ac456

#### Manual

- [ ] 3.4 Dashboard z aktywnym meterem bez regresji
- [ ] 3.5 Dezaktywacja otwiera dialog i zmienia widok
- [ ] 3.6 Reaktywacja przywraca normalny widok
- [ ] 3.7 Sync button wyłączony przy inactive meterze
