-- Fixes a real production bug in 080_notification_center.sql: it replaced
-- notifications' full unique index on source_event_id with a PARTIAL one
-- (WHERE source_event_id IS NOT NULL), reasoning that state-derived
-- notification rows (Low Stock, etc.) insert with source_event_id = NULL
-- and shouldn't collide with each other under a uniqueness constraint.
--
-- But a plain (non-partial) UNIQUE index on a nullable column already has
-- that property natively -- SQL treats every NULL as distinct from every
-- other NULL for uniqueness purposes, so multiple NULL-source_event_id rows
-- were never going to conflict under a full index either. The partial index
-- was unnecessary, and it breaks something real: src/data/powersync/ops.ts
-- unconditionally upserts notifications via supabase-js's
-- `.upsert(row, { onConflict: 'source_event_id', ignoreDuplicates: true })`,
-- which generates a plain `ON CONFLICT (source_event_id) DO NOTHING` with NO
-- predicate. Postgres's ON CONFLICT inference only matches a partial index
-- when the ON CONFLICT clause repeats its exact predicate -- ops.ts's
-- generic upsert path has no way to do that, so every notification upload
-- that hits a real conflict raises 42P10 ("no unique or exclusion
-- constraint matching the ON CONFLICT specification") instead of silently
-- deduplicating. This is the same class of mistake this codebase already
-- corrected once for audit_log (WAFI-150 final review, see
-- wafi150_audit_dedup.test.sql's "now-total unique index" comment) --
-- notifications independently repeated it in 080.
DROP INDEX IF EXISTS public.notifications_source_event_id_unique;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_source_event_id_unique
  ON public.notifications (source_event_id);
