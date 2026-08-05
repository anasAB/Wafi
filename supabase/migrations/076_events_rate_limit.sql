-- supabase/migrations/076_events_rate_limit.sql
-- WAFI-140 Sprint 3 -- server-side rate limit on events inserts (design spec §4b). The
-- real boundary; the client-side token bucket (publishRateLimiter.ts) is a cheap first
-- line of defense in front of this, not a replacement for it.

CREATE OR REPLACE FUNCTION public.enforce_events_rate_limit()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_count integer;
BEGIN
  -- created_at (wall-clock insert time), not occurred_at (business time) -- deliberately:
  -- occurred_at can be backdated by the retry queue replaying an event whose original
  -- occurredAt is hours old (Sprint 2 design spec §4), so filtering on it would
  -- under-count a burst of genuinely simultaneous inserts that happen to carry old
  -- business timestamps. created_at is always "when this row actually landed."
  SELECT count(*) INTO v_count FROM public.events
  WHERE shop_id = NEW.shop_id AND created_at > now() - interval '1 minute';
  -- Intentionally approximate under concurrent inserts, not exact: two concurrent
  -- transactions can each observe a count below 500 before either commits, so the real
  -- cap under concurrency is "500 plus however many inserts were in flight at the same
  -- instant." Acceptable for this project's workload -- the goal is abuse prevention
  -- (stopping a runaway loop), not an exact quota.
  IF v_count >= 500 THEN
    RAISE EXCEPTION 'events_rate_limit_exceeded' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS events_rate_limit_trigger ON public.events;
CREATE TRIGGER events_rate_limit_trigger
  BEFORE INSERT ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.enforce_events_rate_limit();

-- events_shop_type_idx (shop_id, type, occurred_at DESC), from 074_events_bus_core.sql,
-- does NOT cover this trigger's created_at filter -- a query on (shop_id, created_at)
-- only gets partial benefit (the shop_id equality) from that index, not the range
-- condition. Without a dedicated index, this trigger degrades to a shop_id-filtered
-- sequential scan on every single insert.
--
-- Known scaling ceiling (design spec §4b), not a problem at this project's expected
-- scale (a single part-time shop): a count(*)-per-insert check itself becomes the
-- bottleneck once per-shop insert rates approach several hundred/second, since every
-- insert pays for scanning up to 500 prior rows. The fix at that point is a rolling
-- counter table (one row per (shop_id, minute_bucket), incremented via ON CONFLICT DO
-- UPDATE), not re-tuning this count(*) approach -- flagged here so a future ticket
-- scaling past single-shop volume doesn't rediscover this from a production slowdown.
CREATE INDEX IF NOT EXISTS events_shop_created_at_idx ON public.events (shop_id, created_at);
