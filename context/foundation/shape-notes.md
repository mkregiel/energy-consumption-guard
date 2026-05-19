---
project: Monitor zużycia prądu w gospodarstwie domowym
context_type: greenfield
created: 2026-05-19
updated: 2026-05-19
product_type: web-app
target_scale:
  users: small
timeline_budget:
  mvp_weeks: 3
  hard_deadline: 2026-08-10
  after_hours_only: true
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  gray_areas_resolved:
    - topic: pain category
      decision: workflow friction + missing capability; forgetting meter reads creates gaps and uncertainty in assessment
    - topic: insight
      decision: daily (or finer) granularity, proactive alert on limit, anomaly detection after events like breaker reset
    - topic: primary persona scope
      decision: single user, single household (self)
    - topic: access model
      decision: login (email + password); flat single-user model, no roles
    - topic: MVP data source
      decision: Tuya / Smart Life integration for consumption data
    - topic: MVP timeline
      decision: fits in ~3 weeks after-hours
  frs_drafted: 6
  quality_check_status: accepted
---

## Seed idea

aplikacja monitorująca zużycie prądu w gospodarstwie domowym i wysyłająca powiadomienie gdy przekroczony zostanie ustalony limit

## Vision & Problem Statement

Właściciel domu płacący rachunki za prąd traci kontrolę nad zużyciem, gdy rachunek w danym okresie (np. luty) okazuje się znacznie wyższy niż w analogicznym okresie rok wcześniej — coś w domu zużywa dużo więcej energii, ale przyczyna nie jest od razu widoczna. Obecny workaround to reset bezpieczników oraz codzienne odczyty licznika (zdjęcia rano i wieczorem) z ręcznym liczeniem dobowej różnicy; to kosztuje czas i wysiłek, wymaga pamiętania o odczycie, a pominięty odczyt tworzy „dziurę” w monitorowaniu i niepewność co do realnego zużycia.

Produkt ma sens, bo status quo (rachunek co okres rozliczeniowy, brak alertu) nie daje dziennej (ani częstszej) widoczności ani sygnału przy przekroczeniu limitu — użytkownik potrzebuje wcześniejszej informacji i wykrywania anomalii (np. po resecie bezpieczników), a nie tylko sumowania po fakcie.

## User & Persona

**Primary persona:** Właściciel / mieszkaniec jednego gospodarstwa domowego — sam płaci rachunki i chce kontroli nad zużyciem prądu. Moment sięgnięcia po produkt: po nieoczekiwanie wysokim rachunku lub w trakcie codziennego rytuału odczytu licznika, gdy szuka sposobu na automatyczną kontrolę zamiast ręcznych zdjęć i liczenia.

---

## Access Control

Logowanie: email + hasło (konto użytkownika na serwerze).

Model dostępu: płaski — jeden użytkownik, jedno gospodarstwo; bez ról (admin/członek/gość) w MVP.

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

## User Stories

### US-01: Alarm email when consumption exceeds limit

Given I am logged in, I have a device connected in Tuya, a configured limit, and a notification email address,
When energy consumption in the configured time window is exceeded,
Then I receive an email notification about the alarm.

## Business Logic

Aplikacja odczytuje zużycie prądu w określonym oknie czasowym, porównuje je ze skonfigurowanym limitem i wysyła powiadomienie, gdy limit jest przekroczony.

**Wejścia (ustawiane przez użytkownika / pobierane z integracji):** zużycie energii z zarejestrowanego licznika (Tuya / Smart Life); limit jako próg kWh w zdefiniowanym oknie czasowym; adres email do powiadomień.

**Wyjście:** powiadomienie email o alarmie przy przekroczeniu limitu w danym oknie.

**W produkcie:** użytkownik konfiguruje konto, licznik, limit i email w aplikacji; porównanie i decyzja o alarmie działają w tle bez codziennego ręcznego odczytu licznika; sygnał o przekroczeniu dociera jako email (US-01).

## Non-Functional Requirements

- System periodically evaluates consumption against limits without user intervention (background operation).
- Configuration flows work on a typical mobile or desktop web browser.

## Non-Goals

- Avoid: prognoza rachunku, ceny energii i taryf — MVP skupia się na zużyciu i limitach, nie na rozliczeniach finansowych.
- Avoid: zaawansowane ML i automatyczne wykrywanie przyczyn wzrostu zużycia w domu — poza MVP (w tym wcześniejsza idea anomalii po resecie bezpieczników bez reguły domenowej w v1).
- Avoid: wiele gospodarstw, kont rodzinnych i ról domowników — jeden użytkownik, jedno gospodarstwo.
- Avoid: powiadomienia push i SMS — w MVP tylko email.
- Avoid: ręczne zdjęcia licznika jako źródło danych — zastąpione integracją Tuya / Smart Life.
- Avoid: integracje poza Tuya / Smart Life w v1 (Home Assistant, API dostawcy sieci itd.).

## Quality cross-check

All required elements present (greenfield). No gaps recorded.

- Access Control: present
- Business Logic (one-sentence rule): present
- Project artifacts: present
- Timeline-cost acknowledgment: present (mvp_weeks: 3, user accepted; hard_deadline: 2026-08-10)
- Non-Goals: present
- Preserved behavior: n/a (greenfield)
