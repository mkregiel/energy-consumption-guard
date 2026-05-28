-- F-02: Tuya OAuth token storage and consumption reading idempotency

-- ---------------------------------------------------------------------------
-- tuya_oauth_tokens — per-user OAuth credentials (server-side access via RLS)
-- ---------------------------------------------------------------------------

CREATE TABLE public.tuya_oauth_tokens (
  user_id UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  access_token_expires_at TIMESTAMPTZ NOT NULL,
  refresh_token_expires_at TIMESTAMPTZ,
  tuya_uid TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tuya_oauth_tokens_access_token_nonempty CHECK (length(trim(access_token)) > 0),
  CONSTRAINT tuya_oauth_tokens_refresh_token_nonempty CHECK (length(trim(refresh_token)) > 0)
);

CREATE TRIGGER tuya_oauth_tokens_set_updated_at
  BEFORE UPDATE ON public.tuya_oauth_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- consumption_readings idempotency — one row per meter + recorded_at
-- ---------------------------------------------------------------------------

ALTER TABLE public.consumption_readings
  ADD CONSTRAINT consumption_readings_meter_id_recorded_at_unique
  UNIQUE (meter_id, recorded_at);

-- ---------------------------------------------------------------------------
-- Row Level Security — tuya_oauth_tokens
-- ---------------------------------------------------------------------------

ALTER TABLE public.tuya_oauth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tuya_oauth_tokens FORCE ROW LEVEL SECURITY;

CREATE POLICY tuya_oauth_tokens_select_own ON public.tuya_oauth_tokens
  FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY tuya_oauth_tokens_insert_own ON public.tuya_oauth_tokens
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY tuya_oauth_tokens_update_own ON public.tuya_oauth_tokens
  FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY tuya_oauth_tokens_delete_own ON public.tuya_oauth_tokens
  FOR DELETE
  USING (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tuya_oauth_tokens TO authenticated;
GRANT ALL ON public.tuya_oauth_tokens TO service_role;
