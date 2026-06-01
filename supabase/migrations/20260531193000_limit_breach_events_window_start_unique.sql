-- Idempotent breach events per limit calendar window (F-03 review fix F1)

ALTER TABLE public.limit_breach_events
  ADD COLUMN window_start TIMESTAMPTZ;

CREATE UNIQUE INDEX limit_breach_events_limit_id_window_start_unique
  ON public.limit_breach_events (limit_id, window_start)
  WHERE window_start IS NOT NULL;

-- Eligible batch sync targets: meters with linked Tuya OAuth (impl review F4)
CREATE OR REPLACE FUNCTION public.get_eligible_sync_targets()
RETURNS TABLE (user_id UUID, meter_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.user_id, m.id AS meter_id
  FROM public.meters m
  INNER JOIN public.tuya_oauth_tokens t ON t.user_id = m.user_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_eligible_sync_targets() TO service_role;

-- Window consumption aggregate (impl review F5)
CREATE OR REPLACE FUNCTION public.sum_meter_consumption_in_window(
  p_meter_id UUID,
  p_window_start TIMESTAMPTZ,
  p_window_end TIMESTAMPTZ
)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(kwh_delta), 0)
  FROM public.consumption_readings
  WHERE meter_id = p_meter_id
    AND recorded_at >= p_window_start
    AND recorded_at < p_window_end;
$$;

GRANT EXECUTE ON FUNCTION public.sum_meter_consumption_in_window(UUID, TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
