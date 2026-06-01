---
change-id: background-limit-evaluation
title: Background limit evaluation
status: implementing
created: 2026-05-31
updated: 2026-05-31
---

## Notes

Foundation slice F-03 from roadmap: scheduled jobs compare stored consumption against configured limits and emit `limit_breach_events` (no email — F-04). Prerequisites: F-01 (implemented). Reuses F-02 sync logic for optional batch Tuya sync cron. Unlocks S-05.
