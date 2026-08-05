-- WAFI-150 -- adds the idempotency/traceability key linking an audit_log row back to
-- the events row that produced it (design spec, "Idempotency and the audit_log schema
-- change"). Nullable + partial unique index: pre-WAFI-150 rows and manual
-- security/technical audit rows (never wired to the event bus) have no source event
-- and are unaffected by this constraint.

ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS source_event_id uuid;
COMMENT ON COLUMN public.audit_log.source_event_id IS
  'References the originating row in events.id; exists solely for idempotency and traceability. Every audit entry generated from the event bus stores the originating event''s ID. Legacy/manual audit rows leave this column NULL.';

CREATE UNIQUE INDEX IF NOT EXISTS audit_log_source_event_id_unique
  ON public.audit_log (source_event_id) WHERE source_event_id IS NOT NULL;
