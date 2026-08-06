-- WAFI-150 -- adds the idempotency/traceability key linking an audit_log row back to
-- the events row that produced it (design spec, "Idempotency and the audit_log schema
-- change"). Nullable, TOTAL (non-partial) unique index: pre-WAFI-150 rows and manual
-- security/technical audit rows (never wired to the event bus) leave this column NULL,
-- and Postgres unique indexes already permit unlimited NULLs, so they are unaffected
-- by this constraint without needing a WHERE predicate.
--
-- Final review (C1) found the original partial index (`WHERE source_event_id IS NOT
-- NULL`) cannot be used as a PostgREST/supabase-js `onConflict` arbiter -- Postgres
-- will not infer a partial unique index for ON CONFLICT unless the statement repeats
-- the exact predicate, which supabase-js's `onConflict` option has no way to express.
-- `src/data/powersync/ops.ts`'s `.upsert(..., { onConflict: 'source_event_id' })`
-- would raise 42P10 against the partial version. A plain unique index is semantically
-- identical for this table's actual data and IS inferable by ON CONFLICT.

ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS source_event_id uuid;
COMMENT ON COLUMN public.audit_log.source_event_id IS
  'References the originating row in events.id; exists solely for idempotency and traceability. Every audit entry generated from the event bus stores the originating event''s ID. Legacy/manual audit rows leave this column NULL.';

-- DROP + recreate, not a bare IF NOT EXISTS: any environment that already applied this
-- migration's original (partial, broken) version has an index of this same name on
-- disk, so IF NOT EXISTS alone would silently no-op and leave the broken partial index
-- in place. Drop unconditionally by name first so the plain version below always wins.
DROP INDEX IF EXISTS audit_log_source_event_id_unique;
CREATE UNIQUE INDEX audit_log_source_event_id_unique
  ON public.audit_log (source_event_id);
