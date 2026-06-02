-- F-04: retry tracking for breach notification emails (Resend delivery job)

ALTER TABLE public.limit_breach_events
  ADD COLUMN notification_attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN notification_failed_at TIMESTAMPTZ NULL;

ALTER TABLE public.limit_breach_events
  ADD CONSTRAINT limit_breach_events_notification_attempt_count_nonneg
  CHECK (notification_attempt_count >= 0);
