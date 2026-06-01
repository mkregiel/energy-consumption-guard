---
change-id: background-limit-evaluation
title: Background limit evaluation
status: implementing
created: 2026-05-31
updated: 2026-05-31
---

## Notes

Foundation slice F-03 from roadmap: scheduled jobs compare stored consumption against configured limits and emit `limit_breach_events` (no email — F-04). Prerequisites: F-01 (implemented). Reuses F-02 sync logic for optional batch Tuya sync cron. Unlocks S-05.

## Handoff — Available for F-04

F-04 (email notifications) should **read breach events only** — do not re-implement limit evaluation or re-insert breach rows. Idempotency for email delivery uses `notified_at`, not duplicate `limit_breach_events`.

### Query pattern

Fetch unnotified breaches (service role or server-side job):

```sql
SELECT * FROM limit_breach_events
WHERE notified_at IS NULL
ORDER BY breached_at ASC;
```

After a successful email send, set `notified_at` to the send timestamp (ISO). Do not delete breach rows.

### Cron routes and schedules (UTC)

| Schedule | Job | HTTP fallback |
| --- | --- | --- |
| `0 * * * *` | Batch Tuya sync | `POST /api/cron/sync-readings` |
| `5 * * * *` | Limit evaluation | `POST /api/cron/evaluate-limits` |

Both routes require `Authorization: Bearer <CRON_SECRET>`. Scheduled handler in `src/scheduled.ts` calls the same services directly (no self-HTTP).

### JSON response shapes (monitoring)

Both jobs return:

```json
{
  "ok": true,
  "data": {
    "job": "sync-readings | evaluate-limits",
    "startedAt": "ISO8601",
    "finishedAt": "ISO8601",
    "stats": { "processed": 0, "skipped": 0, "breached": 0, "errors": 0 },
    "errors": [{ "userId": "...", "limitId": "...", "code": "...", "message": "..." }]
  }
}
```

Auth failures: `{ "ok": false, "error": { "code": "CRON_UNAUTHORIZED", "message": "..." } }`.

### Required secrets for production cron

- `SUPABASE_SERVICE_ROLE_KEY` — batch DB access (bypasses RLS)
- `CRON_SECRET` — manual/fallback HTTP triggers
- Existing: `SUPABASE_URL`, Tuya credentials

See `README.md` (Background cron jobs) and `context/deployment/deploy-plan.md` for deploy runbook.
