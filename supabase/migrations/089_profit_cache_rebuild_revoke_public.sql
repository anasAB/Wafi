-- supabase/migrations/089_profit_cache_rebuild_revoke_public.sql
-- Postgres grants EXECUTE on every newly created function to PUBLIC by default.
-- rebuild_profit_cache_scope's GRANT ... TO service_role (087) never revoked
-- that implicit PUBLIC grant, so anon/authenticated (which inherit PUBLIC)
-- could still call it directly -- contradicting this projection's stated
-- service_role-only contract. Explicitly revoke here, matching the pattern
-- _backfill_profit_cache_shop already uses in the same migration (087).
REVOKE ALL ON FUNCTION public.rebuild_profit_cache_scope(uuid) FROM public;
