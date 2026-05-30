# Tuya Device and Consumption Visibility — Plan Brief

> Full plan: `context/changes/tuya-device-and-consumption/plan.md`
> Upstream handoff: `context/changes/tuya-read-integration/change.md`

## What & Why

Wdrażamy slice S-02 — north star produktu: zalogowany użytkownik łączy konto Tuya / Smart Life, rejestruje licznik energii i widzi zużycie w aplikacji. To pierwszy pełny dowód ścieżki FR-002 i warstwy danych pod S-03 (limity) oraz S-05 (alarm email).

## Starting Point

F-01 i F-02 są gotowe: tabele `meters`, `consumption_readings`, `tuya_oauth_tokens`, endpointy `POST /api/tuya/oauth/callback` i `POST /api/tuya/sync`. Dashboard to placeholder (`src/pages/dashboard.astro`). Brakuje OAuth start redirect, listy urządzeń Tuya, API `meters`, UI rejestracji licznika i podglądu odczytów. **Konsola Tuya wymaga `https://` callback URL** — domyślny `npm run dev` to `http://`, więc lokalny OAuth wymaga osobnej fazy HTTPS.

## Desired End State

Użytkownik po zalogowaniu na **`https://127.0.0.1:3000`** (dev): (1) klika „Połącz Tuya” i kończy OAuth H5, (2) wybiera urządzenie z listy Smart Life lub wpisuje Device ID ręcznie, (3) uruchamia Sync i widzi ostatni odczyt kWh oraz tabelę ostatnich odczytów z bazy — bez wykresów i bez cron (F-03).

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Lokalny dev HTTPS | mkcert + `npm run dev:https` na porcie 3000 | Tuya odrzuca `http://` callback; Supabase już ma `https://127.0.0.1:3000` w redirect URLs | Plan |
| Widok zużycia | Ostatni odczyt + tabela N | Więcej kontekstu niż sam hero, bez kosztu biblioteki wykresów | Plan |
| Rejestracja licznika | Lista Tuya + fallback ręczny ID | FR-002 dla nietechnicznych + odporność na błędy API uprawnień | Plan |
| Meter API | W S-02 (`/api/meters`) | Odblokowuje north star bez czekania na F-05; ten sam wzorzec co Tuya routes | Plan |
| Ładowanie odczytów | SSR Astro + RLS | Prostsze; sync kończy się reload lub odświeżeniem island | Plan |
| OAuth start | `GET /api/tuya/oauth/start` + cookie state | Bezpieczny HttpOnly state; spójne z istniejącym callback | Plan |
| Błędy integracji | Inline banner + CTA | Mapowanie `error.code` na akcję (ponów link / wybierz urządzenie / sync) | Plan |
| Must-have | Pełny flow link → meter → sync → widok | Zamknięcie north star i odblokowanie S-03 | Plan |

## Scope

**In scope:**

- **Faza 1:** lokalny HTTPS (mkcert, certy w `certs/`, `dev:https`, dokumentacja Tuya callback),
- OAuth H5 start redirect + strona powrotu + UI linkowania,
- `GET /api/tuya/status`, `GET /api/tuya/devices`,
- `GET`/`POST /api/meters` (jeden licznik per user),
- UI wyboru urządzenia (hybrid) + rejestracja `meters`,
- dashboard zużycia: hero + tabela ostatnich odczytów + Sync on-demand,
- hooki w `src/components/hooks/`, rozszerzenie `PROTECTED_ROUTES`,
- mapa błędów Tuya po polsku w UI.

**Out of scope:**

- Wykresy historyczne, agregacje okien limitu (S-03),
- Cron / F-03, limity, email alarmów (S-03–S-05, F-03, F-04),
- Globalny middleware guard F-05 (route-level session wystarczy w S-02),
- Wielu liczników per user (constraint F-01),
- Integracje poza Tuya / Smart Life,
- Tunel (ngrok) jako domyślna ścieżka dev (opcjonalna wzmianka tylko).

## Architecture / Approach

```
dev:https → https://127.0.0.1:3000
User → /dashboard (SSR: meter, readings)
     → GET /api/tuya/oauth/start → Tuya H5 → /dashboard/tuya/callback → POST /api/tuya/oauth/callback
     → GET /api/tuya/devices → wybór → POST /api/meters
     → POST /api/tuya/sync → consumption_readings
```

Warstwa prezentacji: Astro SSR + React islands (`client:load`) dla OAuth callback, device picker i Sync. API: JSON + zod + `prerender = false`, envelope jak F-02.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Local HTTPS dev | mkcert, `dev:https`, port 3000, README + Tuya callback URL | mkcert nie zainstalowany / zły trust store na Windows |
| 2. API & routing foundation | oauth/start, status, devices, meters API; typy; listDevices | Tuya device-list API wymaga uprawnień |
| 3. OAuth linking UI | Przycisk połączenia, callback page, hook | Redirect URI mismatch w konsoli Tuya |
| 4. Meter registration | Lista urządzeń + formularz ręczny ID | Puste listy po OAuth — UX fallback |
| 5. Consumption dashboard | Hero + tabela N + Sync + błędy inline | SSR stale po sync bez reload |
| 6. E2E verification | Dowód pełnego flow na realnym koncie | Brak urządzenia energii w Smart Life |

**Prerequisites:** F-01, F-02, S-01; mkcert na maszynie dev; `TUYA_*` w `.env`; callback `https://127.0.0.1:3000/dashboard/tuya/callback` w Tuya Developer Console.

**Estimated effort:** ~4–5 sesji implementacyjne, 6 faz sekwencyjnych.

## Open Risks & Assumptions

- Phase 1 must complete before any Tuya OAuth UI testing — `http://` callbacks cannot be registered.
- Supabase `site_url` may need https alignment when using `dev:https` (see plan Phase 1).
- Endpoint listy urządzeń Tuya może wymagać dodatkowych scope — fallback ręczny ID łagodzi ryzyko.
- Po Sync użytkownik odświeża stronę (SSR-only) — akceptowane w MVP.

## Success Criteria (Summary)

- `npm run dev:https` działa bez ostrzeżenia certyfikatu; Tuya console akceptuje lokalny callback HTTPS.
- Pełny flow E2E: login → link Tuya → zarejestruj licznik → sync → widoczny odczyt i historia w tabeli.
- Powtórny sync nie duplikuje wiersza (F-02 idempotency zachowana).
- `npm run lint` i `npm run build` przechodzą.
