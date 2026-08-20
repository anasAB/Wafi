-- supabase/migrations/103_wafi147b_generate_scheduled_reports.sql
-- WAFI-147B. The cadence resolver pg_cron calls. Thin: resolves the slot,
-- finds applicable shops, delegates all computation to
-- generate_report_snapshot(). Never computes a report itself.

CREATE OR REPLACE FUNCTION public._wafi147b_report_types_for_cadence(p_cadence text)
RETURNS text[] LANGUAGE sql IMMUTABLE
SET search_path = public, pg_catalog
AS $$
  SELECT CASE p_cadence
    WHEN 'daily' THEN ARRAY['daily-closing', 'cash-flow']
    WHEN 'weekly' THEN ARRAY['weekly-summary', 'inventory-health', 'discount-report',
                             'returns-report', 'credit-report', 'dead-stock']
    WHEN 'monthly' THEN ARRAY['monthly-health', 'profit-trend', 'top-customers', 'top-products']
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.generate_scheduled_reports(
  p_cadence text,
  p_scheduled_for timestamptz DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_slot timestamptz;
  v_report_types text[];
  v_shop record;
  v_report_type text;
BEGIN
  v_report_types := public._wafi147b_report_types_for_cadence(p_cadence);
  IF v_report_types IS NULL THEN
    RAISE EXCEPTION 'unknown cadence: %', p_cadence;
  END IF;

  IF p_scheduled_for IS NOT NULL THEN
    -- Validate the explicit slot is a real canonical slot for this cadence
    -- (design spec "Validation invariant") -- reject before any generation.
    IF p_cadence = 'daily' AND (p_scheduled_for::time != '00:00:00' OR p_scheduled_for != date_trunc('day', p_scheduled_for)) THEN
      RAISE EXCEPTION 'invalid daily slot: % is not 00:00 UTC', p_scheduled_for;
    ELSIF p_cadence = 'weekly' AND (extract(dow from p_scheduled_for) != 0 OR p_scheduled_for::time != '09:00:00') THEN
      RAISE EXCEPTION 'invalid weekly slot: % is not a Sunday 09:00 UTC', p_scheduled_for;
    ELSIF p_cadence = 'monthly' AND (extract(day from p_scheduled_for) != 1 OR p_scheduled_for::time != '09:00:00') THEN
      RAISE EXCEPTION 'invalid monthly slot: % is not the 1st 09:00 UTC', p_scheduled_for;
    END IF;
    v_slot := p_scheduled_for;
  ELSE
    -- Resolve the most recent canonical slot at-or-before actual execution
    -- time (design spec "Precise resolution rule") -- never a bare now().
    IF p_cadence = 'daily' THEN
      v_slot := date_trunc('day', clock_timestamp());
    ELSIF p_cadence = 'weekly' THEN
      v_slot := date_trunc('day', clock_timestamp())
        - (extract(dow from clock_timestamp())::int * interval '1 day')
        + interval '9 hours';
      IF v_slot > clock_timestamp() THEN v_slot := v_slot - interval '7 days'; END IF;
    ELSE -- monthly
      v_slot := date_trunc('month', clock_timestamp()) + interval '9 hours';
      IF v_slot > clock_timestamp() THEN v_slot := v_slot - interval '1 month'; END IF;
    END IF;
  END IF;

  -- Applicable shops: every shop, unconditionally (public.shops has no
  -- is_active column -- there is currently no notion of a shop being
  -- "inactive" for scheduling purposes). Per-shop opt-out of scheduled
  -- reports is a real gap but is explicitly out of scope here; tracked as a
  -- follow-up ticket, not silently invented via a nonexistent column.
  FOR v_shop IN SELECT id FROM public.shops LOOP
    FOREACH v_report_type IN ARRAY v_report_types LOOP
      -- Failure isolation (design spec, Option A): one item's exception is
      -- caught here and does not abort the remaining items in this loop.
      -- This does NOT mean each item commits independently of the others --
      -- see the spec's honest statement of what this subtransaction
      -- boundary does and does not guarantee under a catastrophic crash of
      -- this whole function's outer transaction.
      BEGIN
        DECLARE
          v_period record;
        BEGIN
          SELECT * INTO v_period FROM public._wafi147b_expected_period(v_report_type, v_slot);
          PERFORM public.generate_report_snapshot(
            v_shop.id, v_report_type, v_period.period_start, v_period.period_end, v_slot
          );
        END;
      EXCEPTION WHEN OTHERS THEN
        -- Rollback-surviving observability (design spec): RAISE WARNING
        -- goes to the server log / connected client, outside this
        -- function's own transaction, so it survives even if the outer
        -- transaction this whole call is part of later rolls back.
        RAISE WARNING 'generate_report_snapshot failed for shop=%, report_type=%, slot=%: %',
          v_shop.id, v_report_type, v_slot, SQLERRM;
      END;
    END LOOP;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_scheduled_reports(text, timestamptz) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public._wafi147b_report_types_for_cadence(text) FROM public, anon, authenticated;
