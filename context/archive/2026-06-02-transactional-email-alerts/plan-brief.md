# Transactional Email Alerts — Plan Brief

> Full plan: `context/changes/transactional-email-alerts/plan.md`
> Upstream handoff: `context/changes/background-limit-evaluation/change.md`

## What & Why

F-04 dostarcza foundation do wysyłki **transactional email** przy alarmie zużycia: gdy F-03 zapisze `limit_breach_events` z `notified_at IS NULL`, osobny job co godzinę (:10 UTC) wysyła plain-text wiadomość na adres z `notification_settings` i oznacza breach jako powiadomiony. To domyka warstwę infrastruktury pod US-01 (FR-005) bez UI konfiguracji (S-04) i bez pełnego E2E (S-05).

## Starting Point

F-01 zdefiniował `notification_settings` i `limit_breach_events.notified_at`. F-03 co `:05` UTC ewaluuje limity i wstawia breach events (max jeden na limit/okno). Cron + service role + wzorce `cron-auth` działają. Brak kodu email i brak zależności Resend w `package.json`.

## Desired End State

Operator z Resend i zweryfikowanym `from` uruchamia trzeci cron; użytkownik z seedowanym adresem alarmowym dostaje email po breach; `notified_at` zapobiega duplikatom; po 3 nieudanych próbach `notification_failed_at` zatrzymuje pętlę retry. S-05 może skupić się na E2E z UI S-03/S-04.

## Key Decisions Made

| Decision                     | Choice                                      | Why (1 sentence)                                         | Source |
| ---------------------------- | ------------------------------------------- | -------------------------------------------------------- | ------ |
| Email provider               | Resend (REST via `fetch`)                   | Prosty HTTP, bez SDK — pasuje do Cloudflare Workers      | Plan   |
| Trigger                      | Cron `10 * * * *` UTC                       | Oddzielenie od evaluate `:05`; świeże breach events      | Plan   |
| Brak `notification_settings` | Skip + `NO_NOTIFICATION_SETTINGS` w errors  | S-04 jeszcze nie ma UI; nie wysyłamy na losowy adres     | Plan   |
| Format wiadomości            | Plain text (PL)                             | Najszybsze MVP; bez biblioteki szablonów                 | Plan   |
| Błąd wysyłki                 | Max 3 próby, potem `notification_failed_at` | Ogranicza spam przy awarii Resend; wymaga małej migracji | Plan   |
| Scope change                 | Tylko F-04 foundation                       | S-04/S-05 i middleware cron osobno                       | Plan   |

## Scope

**In scope:**

- Migracja retry (`notification_attempt_count`, `notification_failed_at`)
- Resend client + job `runBreachNotifications`
- Route `POST /api/cron/send-notifications` + scheduled + wrangler cron
- Sekrety `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
- README + handoff dla S-05

**Out of scope:**

- S-04 (konfiguracja email w UI/API)
- S-05 (E2E US-01)
- S-03 (limity UI)
- Middleware allowlist `/api/cron/`
- HTML email, i18n, push/SMS

## Architecture / Approach

```
:05 evaluate-limits → INSERT limit_breach_events (notified_at NULL)
:10 send-notifications → SELECT pending breaches
                      → JOIN notification_settings + limit metadata
                      → POST Resend /emails
                      → UPDATE notified_at | attempt_count | failed_at
```

Job używa tego samego service role co F-03. Idempotencja dostawy = `notified_at`. F-03 nie dotyka emaili.

## Phases at a Glance

| Phase                           | What it delivers           | Key risk                                       |
| ------------------------------- | -------------------------- | ---------------------------------------------- |
| 1. Schema & secrets             | Kolumny retry + env Resend | Migracja przed deploy kodu                     |
| 2. Email & notification service | Resend + batch job         | Niezweryfikowana domena `from` w Resend        |
| 3. Cron wiring                  | Route + scheduled `:10`    | Lokalny HTTP cron może dostać 401 z middleware |
| 4. Docs & handoff               | README, S-05 contract      | Operator musi ręcznie ustawić sekrety prod     |

**Prerequisites:** F-01, F-03 done; konto Resend z verified domain; dla testów — ręczny seed `notification_settings`.

**Estimated effort:** ~2 sesje, 4 fazy (foundation only).

## Open Risks & Assumptions

- **Middleware vs `/api/cron/*`:** Ręczne `Invoke-WebRequest` lokalnie może wymagać sesji użytkownika; produkcyjny `scheduled` działa poprawnie.
- **Resend `from`:** Adres musi być zweryfikowany w Resend — inaczej wszystkie wysyłki failują.
- **S-04:** Bez UI użytkownik nie ustawi emaila — testy wymagają seedu w Studio.
- **Assumption:** Max **3** próby wysyłki (ustalone w planie po wyborze „retry cap”).

## Success Criteria (Summary)

- Po breach i skonfigurowanym `alarm_email` użytkownik otrzymuje plain-text email, a wiersz ma `notified_at`.
- Ponowny cron nie wysyła tego samego breach ponownie.
- Po 3 błędach Resend breach ma `notification_failed_at` i nie jest ponawiany.
- `wrangler tail` pokazuje podsumowanie joba `send-notifications`.
