-- Meter activation status (tuya-detach-device, Phase 1)

ALTER TABLE public.meters
  ADD COLUMN status TEXT NOT NULL DEFAULT 'active'
  CONSTRAINT meters_status_check CHECK (status IN ('active', 'inactive'));

-- Re-create get_eligible_sync_targets() with status filter
CREATE OR REPLACE FUNCTION public.get_eligible_sync_targets()
RETURNS TABLE (user_id UUID, meter_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT m.user_id, m.id AS meter_id
  FROM public.meters m
  INNER JOIN public.tuya_oauth_tokens t ON t.user_id = m.user_id
  WHERE m.status = 'active';
$$;
