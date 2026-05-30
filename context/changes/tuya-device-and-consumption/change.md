---
change-id: tuya-device-and-consumption
title: Tuya device and consumption visibility
status: implementing
created: 2026-05-30
updated: 2026-05-30
---

## Notes

Roadmap slice S-02 (north star): connect an energy meter via Tuya / Smart Life and show consumption in the app. Builds on implemented F-01 (schema), F-02 (Tuya read integration), and S-01 (login). Meter REST API is included in this slice (F-05 deferred; routes use local session checks like F-02).

**Phase 1 (prerequisite):** local HTTPS dev via mkcert + `npm run dev:https` on `https://127.0.0.1:3000` — Tuya Developer Console rejects `http://` callback URLs.
