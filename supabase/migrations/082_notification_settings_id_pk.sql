-- supabase/migrations/082_notification_settings_id_pk.sql
-- WAFI-145 final-review fix (C1/C2) -- notification_settings needs a UUID `id`
-- primary key like every other synced table. PowerSync requires a UUID `id`
-- PRIMARY KEY on every table it syncs, and the generic upload path in ops.ts
-- does `supabase.from(table).upsert({ id, ...opData })` -- with no `id` column
-- (080_notification_center.sql shipped it with `PRIMARY KEY (shop_id, type)`
-- instead), that upsert hard-fails against this table and stalls the entire
-- upload queue.
--
-- Forward-only migration per this repo's convention -- 080 is already applied
-- and is never edited in place.

ALTER TABLE public.notification_settings ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();

-- Backfill any pre-082 rows (shouldn't be any on a fresh install, but this
-- migration must be safe to run against a shop that already wrote settings
-- under 080's schema) before the column is made NOT NULL.
UPDATE public.notification_settings SET id = gen_random_uuid() WHERE id IS NULL;

ALTER TABLE public.notification_settings ALTER COLUMN id SET NOT NULL;

ALTER TABLE public.notification_settings DROP CONSTRAINT IF EXISTS notification_settings_pkey;
ALTER TABLE public.notification_settings ADD CONSTRAINT notification_settings_pkey PRIMARY KEY (id);

ALTER TABLE public.notification_settings DROP CONSTRAINT IF EXISTS notification_settings_shop_id_type_key;
ALTER TABLE public.notification_settings ADD CONSTRAINT notification_settings_shop_id_type_key UNIQUE (shop_id, type);
