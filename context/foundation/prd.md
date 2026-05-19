---
project: Monitor zużycia prądu w gospodarstwie domowym
version: 1
status: draft
created: 2026-05-19
context_type: greenfield
product_type: web-app
target_scale:
  users: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: 2026-08-10
  after_hours_only: true
---

## Vision & Problem Statement

Właściciel domu płacący rachunki za prąd traci kontrolę nad zużyciem, gdy rachunek w danym okresie (np. luty) okazuje się znacznie wyższy niż w analogicznym okresie rok wcześniej — coś w domu zużywa dużo więcej energii, ale przyczyna nie jest od razu widoczna. Obecny workaround to reset bezpieczników oraz codzienne odczyty licznika (zdjęcia rano i wieczorem) z ręcznym liczeniem dobowej różnicy; to kosztuje czas i wysiłek, wymaga pamiętania o odczycie, a pominięty odczyt tworzy „dziurę” w monitorowaniu i niepewność co do realnego zużycia.

Produkt ma sens, bo status quo (rachunek co okres rozliczeniowy, brak alertu) nie daje dziennej (ani częstszej) widoczności ani sygnału przy przekroczeniu limitu — użytkownik potrzebuje wcześniejszej informacji i wykrywania anomalii (np. po resecie bezpieczników), a nie tylko sumowania po fakcie.

## User & Persona

**Primary persona:** Właściciel / mieszkaniec jednego gospodarstwa domowego — sam płaci rachunki i chce kontroli nad zużyciem prądu. Moment sięgnięcia po produkt: po nieoczekiwanie wysokim rachunku lub w trakcie codziennego rytuału odczytu licznika, gdy szuka sposobu na automatyczną kontrolę zamiast ręcznych zdjęć i liczenia.

## Success Criteria

### Primary

End-to-end flow (MVP):

1. Użytkownik loguje się do aplikacji (konto już istnieje na serwerze).
2. Rejestruje urządzenie zliczające zużycie — podłączone przez integrację Tuya / Smart Life.
3. Konfiguruje limit zużycia: okno czasowe + próg energii (kWh); przekroczenie = alarm.
4. Konfiguruje powiadomienie przy alarmie: adres email.
5. System na bieżąco porównuje zużycie z limitami; przy przekroczeniu wysyła powiadomienie email.

Szacowany czas dostawy MVP: ~3 tygodnie pracy po godzinach (zaakceptowane przez użytkownika).

### Secondary

- Możliwość ustawienia kilku limitów (np. dzienny + tygodniowy) w MVP.

### Guardrails

- Integracja z Tuya / Smart Life nie może psuć istniejącej konfiguracji platformy użytkownika.
- Alarm tylko przy realnym przekroczeniu skonfigurowanego limitu — unikać masowych fałszywych alarmów.

## User Stories

### US-01: Alarm email when consumption exceeds limit

- **Given** I am logged in, I have a device connected in Tuya, a configured limit, and a notification email address
- **When** energy consumption in the configured time window is exceeded
- **Then** I receive an email notification about the alarm

## Functional Requirements

### Authentication

- FR-001: User can log in. Priority: must-have
  > Socrates: Counter-argument considered: server account is heavy overhead for a solo home user — local profile might suffice.
  > Resolution: kept; login with existing server account, email alerts and Tuya sync imply backend anyway.

### Device & integration

- FR-002: User can add or register an energy meter (via Tuya / Smart Life). Priority: must-have
  > Socrates: No strong counter-argument; FR stands as written.

### Limits & alerts

- FR-003: User can add a limit — energy amount (kWh) within a configured time window. Priority: must-have
  > Socrates: Counter-argument considered: one global threshold might be enough for MVP; multiple time windows add complexity.
  > Resolution: kept; one limit per configuration with explicit time window is core MVP; multiple distinct limits deferred to FR-006 (nice-to-have).
- FR-004: User can configure the email address for alarm notifications. Priority: must-have
  > Socrates: No strong counter-argument; FR stands as written.
- FR-005: System can compare consumption from the registered meter against configured limits and send an email when a limit is exceeded. Priority: must-have
  > Socrates: No strong counter-argument; FR stands as written.
- FR-006: User can configure multiple limits (e.g. daily and weekly). Priority: nice-to-have
  > Socrates: Counter-argument considered: even as nice-to-have, pulls extra UI and comparison logic — better suited for v2.
  > Resolution: kept as nice-to-have; ship only if time remains after must-have path; otherwise v2.

## Non-Functional Requirements

- System periodically evaluates consumption against limits without user intervention (background operation).
- Configuration flows work on a typical mobile or desktop web browser.

## Business Logic

Aplikacja odczytuje zużycie prądu w określonym oknie czasowym, porównuje je ze skonfigurowanym limitem i wysyła powiadomienie, gdy limit jest przekroczony.

**Wejścia (ustawiane przez użytkownika / pobierane z integracji):** zużycie energii z zarejestrowanego licznika (Tuya / Smart Life); limit jako próg kWh w zdefiniowanym oknie czasowym; adres email do powiadomień.

**Wyjście:** powiadomienie email o alarmie przy przekroczeniu limitu w danym oknie.

**W produkcie:** użytkownik konfiguruje konto, licznik, limit i email w aplikacji; porównanie i decyzja o alarmie działają w tle bez codziennego ręcznego odczytu licznika; sygnał o przekroczeniu dociera jako email (US-01).

## Access Control

Logowanie: email + hasło (konto użytkownika na serwerze).

Model dostępu: płaski — jeden użytkownik, jedno gospodarstwo; bez ról (admin/członek/gość) w MVP.

## Non-Goals

- Avoid: prognoza rachunku, ceny energii i taryf — MVP skupia się na zużyciu i limitach, nie na rozliczeniach finansowych.
- Avoid: zaawansowane ML i automatyczne wykrywanie przyczyn wzrostu zużycia w domu — poza MVP (w tym wcześniejsza idea anomalii po resecie bezpieczników bez reguły domenowej w v1).
- Avoid: wiele gospodarstw, kont rodzinnych i ról domowników — jeden użytkownik, jedno gospodarstwo.
- Avoid: powiadomienia push i SMS — w MVP tylko email.
- Avoid: ręczne zdjęcia licznika jako źródło danych — zastąpione integracją Tuya / Smart Life.
- Avoid: integracje poza Tuya / Smart Life w v1 (Home Assistant, API dostawcy sieci itd.).

## Open Questions

1. **Semantyka okna czasowego limitu** — Czy limit jest liczony w oknie kalendarzowym (np. doba 00:00–24:00), oknie rolling (ostatnie N godzin), czy innym wzorcu? Wpływa na fałszywe alarmy i zgodność z oczekiwaniami użytkownika. Block: no (MVP można dowieźć z domyślną decyzją), ale warto rozstrzygnąć przed implementacją porównania zużycia.

2. **Wykrywanie anomalii vs Non-Goals** — W wizji pozostaje potrzeba wcześniejszej informacji i „wykrywania anomalii” (np. po resecie bezpieczników), a Non-Goals wykluczają zaawansowane ML i automatyczne wykrywanie przyczyn w v1. Czy w MVP wystarczy wyłącznie reguła progu (FR-005), czy potrzebna jest prostsza heurystyka anomalii bez ML? Block: no.

3. **FR-006 (wiele limitów)** — Nice-to-have: wdrożyć w MVP tylko jeśli starczy czasu po ścieżce must-have, inaczej v2. Block: no.
