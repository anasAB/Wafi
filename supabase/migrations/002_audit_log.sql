-- Wafi POS — Audit Log table
-- Fixes PostgREST error PGRST205 for /rest/v1/audit_log

CREATE TABLE IF NOT EXISTS public.audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     TEXT NOT NULL,
  staff_id    TEXT,
  staff_name  TEXT NOT NULL DEFAULT 'system',
  event       TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT,
  meta        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_shop_created
  ON public.audit_log (shop_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity
  ON public.audit_log (entity_type, entity_id, created_at DESC);

-- Keep permissions aligned with the rest of v1 schema behavior.
GRANT ALL ON TABLE public.audit_log TO anon, authenticated, service_role;
