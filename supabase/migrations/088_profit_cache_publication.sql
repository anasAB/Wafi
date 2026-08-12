-- supabase/migrations/088_profit_cache_publication.sql

-- WAFI-153. PowerSync replication: mirrors 074's idempotent add for
-- daily_event_counts, as its own migration (086/087's convention keeps each
-- migration single-purpose; the apply/rebuild files were already committed).
DO $$
DECLARE
  pub_name text;
BEGIN
  FOREACH pub_name IN ARRAY ARRAY['powersync', 'powersync_publication']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = pub_name) THEN
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = pub_name AND schemaname = 'public' AND tablename = 'profit_cache'
      ) THEN
        EXECUTE format('ALTER PUBLICATION %I ADD TABLE public.profit_cache', pub_name);
      END IF;
    END IF;
  END LOOP;
END $$;
