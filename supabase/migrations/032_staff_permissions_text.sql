-- Wafi POS — ensure staff.permissions is TEXT (not JSONB) and fix any
-- already-double-encoded values, regardless of the column's current type.
--
-- Same bug class as migrations 024 (staff.recovery_codes) and 031
-- (audit_log.meta): the client persists `permissions` as a JSON *string*
-- (JSON.stringify of the StaffPermissions object) through a PowerSync TEXT
-- column. If the Postgres column is JSONB, that string is stored as a JSON
-- string *scalar* (double-encoded) — on sync-back PowerSync hands the client
-- a quoted string, so JSON.parse(r.permissions) in rowToStaff yields a String,
-- not an object. permissionsForRole then spreads that string as
-- `{ ...DEFAULT_CASHIER_PERMISSIONS, ...custom }` — spreading a string adds
-- numeric-indexed character keys, none of which match the named permission
-- flags, so every custom permission silently reverts to the role default. No
-- crash, no visible dash — an owner's granted permissions (e.g. a manager
-- given can_view_reports) quietly stop applying after the first sync
-- round-trip.
--
-- Migration 031 (same fix for audit_log.meta) discovered that column type in
-- this database had already drifted from its migration file's declared JSONB
-- to TEXT (untracked manual fix, presumably), which made a straight
-- `ALTER COLUMN ... TYPE text USING permissions #>> '{}'` fail with
-- "operator does not exist: text #>> unknown" (#>> only applies to jsonb).
-- staff.permissions may or may not have drifted the same way, so this
-- migration checks the live column type instead of assuming 003's declared
-- JSONB still holds, and separately repairs any row already left holding a
-- double-encoded string scalar (which a naive `::text` cast during an earlier
-- untracked fix would have baked in permanently).

DO $$
DECLARE
  col_type text;
BEGIN
  SELECT data_type INTO col_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'staff' AND column_name = 'permissions';

  IF col_type = 'jsonb' THEN
    EXECUTE 'ALTER TABLE public.staff ALTER COLUMN permissions DROP DEFAULT';
    -- #>> '{}' unwraps a double-encoded string scalar to its inner JSON text
    -- in the same step as the type change; a clean jsonb object round-trips
    -- through it as its own JSON text with no loss.
    EXECUTE $q$ALTER TABLE public.staff ALTER COLUMN permissions TYPE text USING permissions #>> '{}'$q$;
    EXECUTE $q$ALTER TABLE public.staff ALTER COLUMN permissions SET DEFAULT '{}'$q$;
  END IF;
END $$;

-- Fix any row still holding a double-encoded string scalar (whether it came
-- from this migration's own jsonb branch or from prior, untracked drift).
-- staff has no append-only guard (unlike audit_log), so this UPDATE needs no
-- trigger dance.
--
-- Row-by-row with exception handling (not a single UPDATE ... WHERE
-- jsonb_typeof(...)): production (see WAFI-001 closeout, 2026-07-26) was found
-- to have at least one row (a "test" staff entry) whose permissions value is
-- not valid JSON at all — several JSON fragments concatenated together, not a
-- double-encoded scalar — which makes the `::jsonb` cast itself raise before
-- jsonb_typeof ever runs, aborting the whole migration. Any row that can't be
-- parsed as JSON gets reset to '{}' (no permission overrides, i.e. role
-- defaults apply) rather than blocking the migration on what is, in every
-- observed case, junk test data rather than a real grant worth preserving.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id, permissions FROM public.staff LOOP
    BEGIN
      IF jsonb_typeof(r.permissions::jsonb) = 'string' THEN
        UPDATE public.staff SET permissions = (r.permissions::jsonb #>> '{}') WHERE id = r.id;
      END IF;
    EXCEPTION WHEN invalid_text_representation THEN
      UPDATE public.staff SET permissions = '{}' WHERE id = r.id;
    END;
  END LOOP;
END $$;

COMMENT ON COLUMN public.staff.permissions IS
  'Per-staff permission overrides as TEXT holding a JSON object (StaffPermissions). TEXT (not JSONB) so the client JSON blob round-trips through PowerSync without double-encoding (migration 032, same fix as migrations 024/031).';
