---
change-id: protected-api-routes
title: Protected API routes
status: archived
created: 2026-05-31
updated: 2026-06-10
archived_at: 2026-06-10T20:29:40Z
---

## Notes

Foundation slice F-05 from roadmap: device, limit, and notification API routes require the same session as the dashboard. Unlocks S-02 (already partially implemented with route-level guards), S-03, S-04.

Roadmap risk: middleware protects `/dashboard` only; `/api/*` relies on per-route `locals.user` checks added in F-02/S-02. This change adds global middleware guard (deny-by-default, allowlist `/api/auth/*`) plus shared `requireUser()` helper and generalized JSON response utilities.
