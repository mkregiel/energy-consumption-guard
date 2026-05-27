-- Energy domain schema (F-01)
-- Tables: meters, consumption_limits, consumption_readings, notification_settings, limit_breach_events

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE public.meters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  tuya_device_id TEXT NOT NULL,
  tuya_product_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT meters_user_id_unique UNIQUE (user_id)
);

CREATE TABLE public.consumption_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  threshold_kwh NUMERIC NOT NULL,
  window_type TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Europe/Warsaw',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT consumption_limits_user_id_unique UNIQUE (user_id),
  CONSTRAINT consumption_limits_threshold_positive CHECK (threshold_kwh > 0),
  CONSTRAINT consumption_limits_window_type CHECK (window_type IN ('day', 'week', 'month'))
);

CREATE TABLE public.consumption_readings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meter_id UUID NOT NULL REFERENCES public.meters (id) ON DELETE CASCADE,
  recorded_at TIMESTAMPTZ NOT NULL,
  kwh_cumulative NUMERIC NOT NULL,
  kwh_delta NUMERIC,
  source TEXT NOT NULL DEFAULT 'tuya',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT consumption_readings_kwh_cumulative_nonneg CHECK (kwh_cumulative >= 0),
  CONSTRAINT consumption_readings_source CHECK (source IN ('tuya', 'manual'))
);

CREATE TABLE public.notification_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  alarm_email TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT notification_settings_alarm_email_nonempty CHECK (length(trim(alarm_email)) > 0)
);

CREATE TABLE public.limit_breach_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  limit_id UUID NOT NULL REFERENCES public.consumption_limits (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  breached_at TIMESTAMPTZ NOT NULL,
  consumption_kwh NUMERIC NOT NULL,
  notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT limit_breach_events_consumption_nonneg CHECK (consumption_kwh >= 0)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

CREATE INDEX consumption_readings_meter_id_recorded_at_idx
  ON public.consumption_readings (meter_id, recorded_at DESC);

CREATE INDEX limit_breach_events_limit_id_breached_at_idx
  ON public.limit_breach_events (limit_id, breached_at DESC);

CREATE INDEX limit_breach_events_user_id_breached_at_idx
  ON public.limit_breach_events (user_id, breached_at DESC);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER meters_set_updated_at
  BEFORE UPDATE ON public.meters
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER consumption_limits_set_updated_at
  BEFORE UPDATE ON public.consumption_limits
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER notification_settings_set_updated_at
  BEFORE UPDATE ON public.notification_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

ALTER TABLE public.meters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meters FORCE ROW LEVEL SECURITY;

ALTER TABLE public.consumption_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consumption_limits FORCE ROW LEVEL SECURITY;

ALTER TABLE public.consumption_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consumption_readings FORCE ROW LEVEL SECURITY;

ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_settings FORCE ROW LEVEL SECURITY;

ALTER TABLE public.limit_breach_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.limit_breach_events FORCE ROW LEVEL SECURITY;

-- meters
CREATE POLICY meters_select_own ON public.meters
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY meters_insert_own ON public.meters
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY meters_update_own ON public.meters
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY meters_delete_own ON public.meters
  FOR DELETE
  USING (user_id = auth.uid());

-- consumption_limits
CREATE POLICY consumption_limits_select_own ON public.consumption_limits
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY consumption_limits_insert_own ON public.consumption_limits
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY consumption_limits_update_own ON public.consumption_limits
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY consumption_limits_delete_own ON public.consumption_limits
  FOR DELETE
  USING (user_id = auth.uid());

-- consumption_readings (ownership via meters)
CREATE POLICY consumption_readings_select_own ON public.consumption_readings
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.meters m
      WHERE m.id = meter_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY consumption_readings_insert_own ON public.consumption_readings
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.meters m
      WHERE m.id = meter_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY consumption_readings_update_own ON public.consumption_readings
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.meters m
      WHERE m.id = meter_id AND m.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.meters m
      WHERE m.id = meter_id AND m.user_id = auth.uid()
    )
  );

CREATE POLICY consumption_readings_delete_own ON public.consumption_readings
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.meters m
      WHERE m.id = meter_id AND m.user_id = auth.uid()
    )
  );

-- notification_settings
CREATE POLICY notification_settings_select_own ON public.notification_settings
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY notification_settings_insert_own ON public.notification_settings
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY notification_settings_update_own ON public.notification_settings
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY notification_settings_delete_own ON public.notification_settings
  FOR DELETE
  USING (user_id = auth.uid());

-- limit_breach_events
CREATE POLICY limit_breach_events_select_own ON public.limit_breach_events
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY limit_breach_events_insert_own ON public.limit_breach_events
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY limit_breach_events_update_own ON public.limit_breach_events
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY limit_breach_events_delete_own ON public.limit_breach_events
  FOR DELETE
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Grants (authenticated role + RLS)
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON public.meters TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consumption_limits TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consumption_readings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.limit_breach_events TO authenticated;

GRANT ALL ON public.meters TO service_role;
GRANT ALL ON public.consumption_limits TO service_role;
GRANT ALL ON public.consumption_readings TO service_role;
GRANT ALL ON public.notification_settings TO service_role;
GRANT ALL ON public.limit_breach_events TO service_role;
