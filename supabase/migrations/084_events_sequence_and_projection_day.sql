-- supabase/migrations/084_events_sequence_and_projection_day.sql

-- WAFI-151 Plan 2. Two new columns on events, both required for deterministic,
-- rebuild-safe replay (see design spec "Canonical Replay Ordering"):
--
-- sequence: events.id is a UUID with no monotonic order. occurred_at is a
-- business timestamp that can collide/skew for offline-authored events and
-- must never be used to order replay. sequence gives a stable total order --
-- NOT a claim of true commit/causal order (allocation can precede commit
-- under concurrent transactions), just unique + stable + total, which is all
-- replay determinism requires. Skip decisions remain keyed on event ID via
-- the existing projection_processed_events ledger (migration 083) -- never
-- on a sequence threshold.
--
-- event_projection_day: the immutable, write-time day bucket. Computed once
-- at insert from occurred_at + the shop's timezone at that moment, and never
-- re-derived at replay time -- so a later shop timezone change cannot
-- silently shift which day historical events replay into.

-- public.shops has no timezone column as of migration 074 (checked: no
-- ALTER TABLE ... shops ... timezone anywhere in supabase/migrations/*.sql).
-- Add it here, before the backfill UPDATE below references s.timezone.
ALTER TABLE public.shops ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'UTC';

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS sequence bigint;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS event_projection_day date;

-- Deterministic backfill for existing rows: created_at ASC, then id ASC as a
-- tiebreak for exact-duplicate timestamps. This is a canonical REPLAY order,
-- not a claim of true historical causal order -- acceptable because the two
-- projections currently in scope (daily_event_counts, local_today_revenue_projection)
-- are both commutative aggregates.
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY created_at ASC, id ASC) AS rn
  FROM public.events
  WHERE sequence IS NULL
)
UPDATE public.events e
SET sequence = ordered.rn + (SELECT coalesce(max(sequence), 0) FROM public.events)
FROM ordered
WHERE e.id = ordered.id;

-- event_projection_day backfill: best-available (current) shop timezone data,
-- since no historical timezone snapshot is stored. This is an accepted
-- data-quality limitation for pre-existing events -- the result is
-- deterministic and stable after backfill (which is what replay needs), not
-- a claim of historical accuracy. New rows (the trigger below) use the
-- shop's timezone in effect at event creation time.
UPDATE public.events e
SET event_projection_day = (e.occurred_at AT TIME ZONE COALESCE(s.timezone, 'UTC'))::date
FROM public.shops s
WHERE e.shop_id = s.id AND e.event_projection_day IS NULL;

-- Any events whose shop row has no timezone match (shouldn't happen given
-- the FK, but be defensive rather than leave a NULL that the NOT NULL below
-- would reject with an opaque error): fall back to UTC.
UPDATE public.events
SET event_projection_day = (occurred_at AT TIME ZONE 'UTC')::date
WHERE event_projection_day IS NULL;

ALTER TABLE public.events ALTER COLUMN sequence SET NOT NULL;
ALTER TABLE public.events ADD CONSTRAINT events_sequence_unique UNIQUE (sequence);
ALTER TABLE public.events ALTER COLUMN event_projection_day SET NOT NULL;

-- New events get sequence from a sequence object (simpler and equally valid
-- for "unique, stable, total" than an identity column here, since backfill
-- already assigned explicit values above) and event_projection_day computed
-- from the shop's current timezone at insert time.
CREATE SEQUENCE IF NOT EXISTS public.events_sequence_seq OWNED BY public.events.sequence;
SELECT setval('public.events_sequence_seq', coalesce((SELECT max(sequence) FROM public.events), 0), true);
ALTER TABLE public.events ALTER COLUMN sequence SET DEFAULT nextval('public.events_sequence_seq');

CREATE OR REPLACE FUNCTION public._set_event_projection_day()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_tz text;
BEGIN
  SELECT timezone INTO v_tz FROM public.shops WHERE id = NEW.shop_id;
  NEW.event_projection_day := (NEW.occurred_at AT TIME ZONE COALESCE(v_tz, 'UTC'))::date;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS events_set_projection_day ON public.events;
CREATE TRIGGER events_set_projection_day
  BEFORE INSERT ON public.events
  FOR EACH ROW
  EXECUTE FUNCTION public._set_event_projection_day();

CREATE INDEX IF NOT EXISTS events_shop_projection_day_sequence_idx
  ON public.events (shop_id, event_projection_day, sequence);

-- Update Plan 1's internal apply function (083) to use the now-real
-- event_projection_day instead of its occurred_at::date placeholder.
CREATE OR REPLACE FUNCTION public._apply_daily_event_count(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_event public.events;
BEGIN
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RETURN; -- event may have been legitimately rejected upstream (e.g. rate-limited);
             -- must not raise, or this jams the sync queue (see Plan 1 final review)
  END IF;

  IF v_event.type <> 'sale.completed' THEN
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.projection_processed_events (projection_name, event_id)
    VALUES ('daily_event_counts', p_event_id);
  EXCEPTION WHEN unique_violation THEN
    RETURN;
  END;

  INSERT INTO public.daily_event_counts (id, shop_id, event_type, day, count, source_event_id)
  VALUES (gen_random_uuid(), v_event.shop_id, v_event.type, v_event.event_projection_day, 1, p_event_id)
  ON CONFLICT (shop_id, event_type, day)
  DO UPDATE SET count = public.daily_event_counts.count + 1;
END;
$$;

-- Design spec's Concurrency section requires a BOUNDED lock wait, not an
-- indefinite block: "on timeout, the rebuild fails fast with a clear
-- operator message rather than blocking normal writes indefinitely." Plan
-- 1's apply_daily_event_count took the lock with a bare pg_advisory_xact_lock
-- (blocks forever) -- fixing that here rather than shipping Plan 2's rebuild
-- function with a timeout while the incremental path still blocks forever,
-- which would be an inconsistent (and spec-violating) lock protocol between
-- the two callers of the same lock.
CREATE OR REPLACE FUNCTION public.apply_daily_event_count(p_event_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET lock_timeout = '5s'
AS $$
DECLARE
  v_shop_id uuid;
BEGIN
  SELECT shop_id INTO v_shop_id FROM public.events WHERE id = p_event_id;
  IF v_shop_id IS NULL THEN
    RETURN; -- matches _apply_daily_event_count's own not-found handling (Plan 1 final review fix)
  END IF;
  IF v_shop_id IS DISTINCT FROM (SELECT public.auth_shop_id()) THEN
    RAISE EXCEPTION 'apply_daily_event_count: caller is not authorized for this event''s shop' USING ERRCODE = 'P0001';
  END IF;

  -- lock_timeout is set at the function level (above) rather than via SET
  -- LOCAL here, so it applies only for this function's duration and Postgres
  -- restores the prior value on return -- SET LOCAL would otherwise leak the
  -- 5s timeout into the rest of the caller's transaction (a PowerSync upload
  -- batch), turning an unrelated slow write later in that same batch into a
  -- spurious failure.
  PERFORM pg_advisory_xact_lock(hashtext('daily_event_counts' || v_shop_id::text));
  PERFORM public._apply_daily_event_count(p_event_id);
END;
$$;
