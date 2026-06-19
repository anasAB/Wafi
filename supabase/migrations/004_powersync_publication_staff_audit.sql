-- Wafi POS — Ensure staff + audit_log are included in PowerSync replication publication.
-- Safe migration: only runs when publication exists and table is not already attached.

DO $$
DECLARE
  pub_name text;
BEGIN
  -- Handle common publication names used in PowerSync setups.
  FOREACH pub_name IN ARRAY ARRAY['powersync', 'powersync_publication']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = pub_name) THEN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = pub_name
          AND schemaname = 'public'
          AND tablename = 'staff'
      ) THEN
        EXECUTE format('ALTER PUBLICATION %I ADD TABLE public.staff', pub_name);
      END IF;

      IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = pub_name
          AND schemaname = 'public'
          AND tablename = 'audit_log'
      ) THEN
        EXECUTE format('ALTER PUBLICATION %I ADD TABLE public.audit_log', pub_name);
      END IF;
    END IF;
  END LOOP;
END $$;
