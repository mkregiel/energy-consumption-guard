---
change-id: transactional-email-alerts
title: Transactional email alerts
status: archived
created: 2026-06-02
updated: 2026-06-10
archived_at: 2026-06-10T20:29:40Z
---

## Notes

Foundation slice F-04 from roadmap: send plain-text alarm emails when `limit_breach_events` exist with `notified_at IS NULL`. Prerequisites: F-01 (schema), F-03 (breach events). Unlocks S-05. Does not include limit/email configuration UI (S-03, S-04).

## Handoff — Available for S-05

F-04 delivers breach alarm email dispatch via Resend. S-04 must populate `notification_settings.alarm_email` for production alarms; S-05 is E2E verification only.

### Cron schedule and route

| Schedule (UTC) | Job                        | HTTP fallback                       |
| -------------- | -------------------------- | ----------------------------------- |
| `10 * * * *`   | Breach email notifications | `POST /api/cron/send-notifications` |

Route requires `Authorization: Bearer <CRON_SECRET>`. Scheduled handler in `src/scheduled.ts` calls `runBreachNotifications` directly (no self-HTTP).

### Pending breaches query

```sql
SELECT * FROM limit_breach_events
WHERE notified_at IS NULL
  AND notification_failed_at IS NULL
ORDER BY breached_at ASC;
```

After a successful send, F-04 sets `notified_at`. Breaches without `notification_settings` are skipped (`NO_NOTIFICATION_SETTINGS` in job `errors[]`).

### Recovery after terminal failure

When `notification_attempt_count` reaches 3, F-04 sets `notification_failed_at` and stops retrying. To retry manually in Supabase Studio:

1. Clear `notification_failed_at` (set to NULL)
2. Reset `notification_attempt_count` to `0`
3. Wait for the next `:10` UTC cron run (or invoke `POST /api/cron/send-notifications`)

### Required secrets

`RESEND_API_KEY` and `RESEND_FROM_EMAIL` (verified sender in Resend dashboard). See README → Background cron jobs.
