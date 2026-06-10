---
change_id: email-alarm-on-limit-breach
title: E2E verification — email alarm on limit breach
status: archived
created: 2026-06-04
updated: 2026-06-10
archived_at: 2026-06-10T20:10:53Z
stream: B
depends_on: [transactional-email-alerts, configure-alarm-email]
---

## Summary

End-to-end verification that the full alarm pipeline works: user configures an alarm email → consumption exceeds limit → breach event is created → notification email is sent and received.

Delivers a reusable seed script (`scripts/seed-test-breach.ts`) that plants test data, triggers both cron jobs via HTTP, and prints structured results. Includes a `--cleanup` flag to remove test rows.

## Scope

- Add `tsx` as a dev dependency
- Add `seed:test-breach` npm script
- Write `scripts/seed-test-breach.ts`
- Manual verification checklist (run against staging, confirm email receipt)
