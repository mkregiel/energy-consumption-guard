# Protected API Routes — Plan Brief

> Full plan: `context/changes/protected-api-routes/plan.md`

## What & Why

Roadmap F-05 wymaga, aby trasy konfiguracyjne API (licznik, limity, powiadomienia, Tuya) wymagały tej samej sesji co `/dashboard`. Bez globalnej ochrony `/api/*` nowa trasa dodana bez lokalnego guarda byłaby publiczna — ryzyko przy S-03/S-04.

## Starting Point

Middleware (`src/middleware.ts`) rozwiązuje sesję dla wszystkich requestów (`locals.user`), ale redirect na sign-in dotyczy tylko `/dashboard`. Trasy `/api/meters` i `/api/tuya/*` mają już lokalne `if (!locals.user)` (F-02/S-02). Brak wspólnego helpera; envelope JSON 401 żyje w `tuya-api-response.ts`. Trasy limitów i powiadomień jeszcze nie istnieją.

## Desired End State

Niezalogowany request do dowolnego `/api/*` poza `/api/auth/*` dostaje spójny JSON 401 `{ ok: false, error: { code: "UNAUTHORIZED", ... } }`. Istniejące trasy używają `requireUser()` z `src/lib/auth-guard.ts` i `apiJsonError`/`apiJsonSuccess` z `src/lib/services/api-response.ts`. AGENTS.md i README dokumentują konwencję dla przyszłych tras S-03/S-04. Auth flow (`/api/auth/*`, `/dashboard`) bez regresji.

## Key Decisions Made

| Decision             | Choice                                | Why (1 sentence)                                                                       | Source |
| -------------------- | ------------------------------------- | -------------------------------------------------------------------------------------- | ------ |
| Warstwy ochrony      | Middleware + lokalne `requireUser()`  | Defense in depth — zgodne z F-02/S-02; nowa trasa bez checku i tak blokowana           | Plan   |
| Refaktor tras        | Helper + uogólniony `api-response.ts` | Jedna definicja 401 i envelope JSON dla meter/Tuya/przyszłych limitów                  | Plan   |
| Middleware 401       | Zawsze JSON 401                       | Spójny kontrakt dla fetch/XHR; OAuth start redirect tylko dla zalogowanych w handlerze | Plan   |
| Allowlista publiczna | Tylko `/api/auth/*`                   | Deny-by-default; prosta reguła zgodna z obecnym stanem repo                            | Plan   |
| Dokumentacja         | AGENTS.md + README                    | Trwała konwencja dla agentów i devów przy S-03/S-04                                    | Plan   |

## Scope

**In scope:**

- `src/lib/services/api-response.ts` — generyczny envelope JSON
- `src/lib/auth-guard.ts` — `requireUser()` (+ opcjonalnie `requireUserRedirect()` dla OAuth start)
- Rozszerzenie `src/middleware.ts` — guard `/api/*` z allowlistą
- Refaktor 6 plików route (meters + tuya) na helpery
- Re-export w `tuya-api-response.ts` dla kompatybilności wstecznej
- `export const prerender = false` na brakujących auth routes
- Aktualizacja AGENTS.md i README (sekcja Auth routes)

**Out of scope:**

- Nowe trasy API (limity, powiadomienia — S-03/S-04)
- Zmiany RLS, migracji DB, UI
- Test runner / infrastruktura testów
- OAuth CSRF fix (`tuya_oauth_state` optional) — osobny change z impl-review
- Service-role / cron endpoints (F-03)

## Architecture / Approach

```
Request
  → middleware.ts
       getUser() → locals.user (wszystkie ścieżki)
       /dashboard/* bez user → redirect /auth/signin
       /api/* (poza /api/auth/*) bez user → JSON 401
  → route handler
       requireUser(locals) → user | Response (defense in depth)
       apiJsonSuccess / apiJsonError
```

Publiczne: `POST /api/auth/signin`, `signup`, `signout`. Chronione: `/api/meters`, `/api/tuya/*`, przyszłe `/api/limits/*`, `/api/notifications/*`.

## Phases at a Glance

| Phase                    | What it delivers                                     | Key risk                                                                         |
| ------------------------ | ---------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1. Shared utilities      | `api-response.ts`, `auth-guard.ts`, re-export z Tuya | Rozjazd envelope między middleware a helperem — jedna stała UNAUTHORIZED         |
| 2. Middleware guard      | Deny-by-default `/api/*`, allowlista auth            | Regresja auth routes; oauth/start bez sesji → 401 zamiast redirect (akceptowane) |
| 3. Route refactor & docs | Migracja 6 tras + AGENTS.md + README                 | Duży diff importów — lint/build jako brama                                       |

**Prerequisites:** Istniejący auth baseline (S-01), trasy meter/Tuya z F-02/S-02.

**Estimated effort:** ~1 sesja implementacji, 3 fazy sekwencyjne.

## Open Risks & Assumptions

- **OAuth start bez sesji** — middleware zwraca JSON 401; flow UI idzie z chronionego `/dashboard`, więc normalny path nie dotknięty.
- **Przyszłe publiczne webhooks** — wymagają świadomej aktualizacji allowlisty w middleware.
- **F-03 cron** — service-role endpoint poza user session; nie wchodzi w allowlistę user API — osobny design w F-03.

## Success Criteria (Summary)

- Niezalogowany `GET /api/meters` → 401 JSON z `code: "UNAUTHORIZED"`
- Niezalogowany `POST /api/auth/signin` → działa (redirect po sukcesie)
- Zalogowany użytkownik — meter/Tuya/sync bez regresji
- `npm run lint` i `npm run build` przechodzą
- AGENTS.md opisuje konwencję chronionych API routes
