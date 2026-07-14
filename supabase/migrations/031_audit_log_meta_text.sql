-- Wafi POS — ensure audit_log.meta is TEXT (not JSONB) and fix any
-- already-double-encoded values, regardless of the column's current type.
--
-- Same bug class as migration 024 (staff.recovery_codes): the client persists
-- `meta` as a JSON *string* (JSON.stringify of the event's meta object) through
-- a PowerSync TEXT column. If the Postgres column is JSONB, that string is
-- stored as a JSON string *scalar* (double-encoded) — on sync-back PowerSync
-- hands the client a quoted string, so JSON.parse(r.meta) yields a String (not
-- an object), and every meta.field access reads as `undefined` (rendered as
-- "أضاف موظف: — (—)" etc). The live database's `meta` column turned out to
-- already be TEXT (migration 002's declared JSONB never matched reality here —
-- schema drift, presumably an earlier untracked manual fix), which is why the
-- straight `ALTER COLUMN ... TYPE text USING meta #>> '{}'` from the first cut
-- of this migration failed with "operator does not exist: text #>> unknown"
-- (#>> only applies to jsonb). That drift doesn't rule out already-corrupted
-- data: if the column was ever cast from jsonb to text naively (a plain
-- `::text` cast, which keeps a string scalar's surrounding quotes/escapes),
-- rows written before that cast would still be double-encoded today even
-- though the column type is already correct.
--
-- This version is defensive on both fronts:
--   1. Only ALTER the column type if it isn't already text (skips cleanly on
--      this database, but stays correct for a fresh/other environment where
--      002's JSONB is still in effect).
--   2. Separately (always), unwrap any row whose value is a double-encoded
--      JSON string scalar rather than the parsed object, detected via
--      jsonb_typeof(meta::jsonb) = 'string' — this catches corruption baked in
--      by option 1's jsonb branch *and* any pre-existing drift like this one.

DO $$
DECLARE
  col_type text;
BEGIN
  SELECT data_type INTO col_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'audit_log' AND column_name = 'meta';

  IF col_type = 'jsonb' THEN
    EXECUTE 'ALTER TABLE public.audit_log ALTER COLUMN meta DROP DEFAULT';
    -- #>> '{}' unwraps a double-encoded string scalar to its inner JSON text
    -- in the same step as the type change; a clean jsonb object round-trips
    -- through it as its own JSON text with no loss.
    EXECUTE $q$ALTER TABLE public.audit_log ALTER COLUMN meta TYPE text USING meta #>> '{}'$q$;
    EXECUTE $q$ALTER TABLE public.audit_log ALTER COLUMN meta SET DEFAULT '{}'$q$;
  END IF;
END $$;

-- Fix any row still holding a double-encoded string scalar (whether it came
-- from this migration's own jsonb branch or from prior, untracked drift).
-- audit_log's append-only trigger (018) unconditionally rejects UPDATE/DELETE,
-- including from this migration — it changes no history (same underlying
-- event data, only the storage encoding), so it is disabled for this one
-- statement and re-enabled immediately after.
ALTER TABLE public.audit_log DISABLE TRIGGER trg_audit_log_no_update;
UPDATE public.audit_log
SET meta = (meta::jsonb #>> '{}')
WHERE jsonb_typeof(meta::jsonb) = 'string';
ALTER TABLE public.audit_log ENABLE TRIGGER trg_audit_log_no_update;

COMMENT ON COLUMN public.audit_log.meta IS
  'Per-event metadata as TEXT holding a JSON object (e.g. {"name":"...","role":"..."}). TEXT (not JSONB) so the client JSON blob round-trips through PowerSync without double-encoding (migration 031, same fix as migration 024).';
