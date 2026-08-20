-- supabase/migrations/102_wafi147b_generate_report_snapshot.sql
-- WAFI-147B. The generation primitive. Trusted-caller only (see search_path/
-- EXECUTE grants below) -- callers (the cadence resolver, future operator
-- recovery, future event triggers) each independently establish that the
-- request is in scope before calling; this function does not re-derive
-- shop/report/period authorization for the CALLER, only validates internal
-- coherence of the (report_type, period, scheduled_for) tuple itself.

-- Derives the expected period for a given (report_type, scheduled_for),
-- per the design spec's Period semantics -- the single source of truth
-- both the coherence check below and future callers must agree with.
CREATE OR REPLACE FUNCTION public._wafi147b_expected_period(
  p_report_type text, p_scheduled_for timestamptz
) RETURNS TABLE(period_start timestamptz, period_end timestamptz)
LANGUAGE plpgsql STABLE
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_cadence text;
BEGIN
  v_cadence := CASE p_report_type
    WHEN 'daily-closing', 'cash-flow' THEN 'daily'
    WHEN 'weekly-summary', 'inventory-health', 'discount-report',
         'returns-report', 'credit-report', 'dead-stock' THEN 'weekly'
    WHEN 'monthly-health', 'profit-trend', 'top-customers', 'top-products' THEN 'monthly'
    ELSE NULL
  END;

  IF v_cadence IS NULL THEN
    RAISE EXCEPTION 'unknown wall-clock report_type: %', p_report_type;
  END IF;

  IF v_cadence = 'daily' THEN
    RETURN QUERY SELECT
      (p_scheduled_for - interval '1 day')::timestamptz,
      p_scheduled_for::timestamptz;
  ELSIF v_cadence = 'weekly' THEN
    -- scheduled_for is always a Sunday 09:00 UTC slot (validated by the
    -- caller/resolver); the reporting week is the COMPLETED week that
    -- ended the day before the trigger day -- 13 days before the
    -- trigger's own midnight through 6 days before it (Mon 00:00 to the
    -- following Mon 00:00, per the design spec's worked example: for
    -- scheduled_for = 2026-08-23, the period is [2026-08-10, 2026-08-17)).
    RETURN QUERY SELECT
      (date_trunc('day', p_scheduled_for) - interval '13 days')::timestamptz,
      (date_trunc('day', p_scheduled_for) - interval '6 days')::timestamptz;
  ELSE -- monthly
    RETURN QUERY SELECT
      (date_trunc('month', p_scheduled_for) - interval '1 month')::timestamptz,
      date_trunc('month', p_scheduled_for)::timestamptz;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_report_snapshot(
  p_shop_id uuid,
  p_report_type text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_scheduled_for timestamptz DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_existing_id uuid;
  v_new_id uuid;
  v_expected record;
  v_report_data jsonb;
  v_staff_section jsonb;
  v_recipient record;
BEGIN
  -- Input-coherence validation (design spec, generation-primitive section):
  -- for wall-clock callers (scheduled_for IS NOT NULL), the supplied period
  -- must exactly match what (report_type, scheduled_for) derives -- never
  -- trust a caller-supplied period independently of the slot.
  IF p_scheduled_for IS NOT NULL THEN
    SELECT * INTO v_expected FROM public._wafi147b_expected_period(p_report_type, p_scheduled_for);
    IF v_expected.period_start IS DISTINCT FROM p_period_start
       OR v_expected.period_end IS DISTINCT FROM p_period_end THEN
      RAISE EXCEPTION
        'period (%,%) does not match what report_type % + scheduled_for % derives: (%,%)',
        p_period_start, p_period_end, p_report_type, p_scheduled_for,
        v_expected.period_start, v_expected.period_end;
    END IF;
  END IF;

  -- Insert-if-absent: existing snapshot for this natural key is a safe no-op.
  SELECT id INTO v_existing_id FROM public.generated_reports
  WHERE shop_id = p_shop_id AND report_type = p_report_type
    AND period_start = p_period_start AND period_end = p_period_end;

  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;

  -- Compute the report. Task 4 wires cash-flow and weekly-summary; Task 6
  -- adds the remaining 10 report_type branches to this same CASE.
  IF p_report_type = 'cash-flow' THEN
    -- profit_cache money columns are bigint CENTS (086_profit_cache_apply.sql:
    -- "minor units (cents), never float") -- divide by 100 before emitting as
    -- USD, matching readProfitCache.ts's cents-first-then-divide convention.
    SELECT jsonb_build_object(
      'id', 'cash-flow', 'name', 'Cash Flow Report',
      'periodStart', p_period_start, 'periodEnd', p_period_end,
      'generatedAt', clock_timestamp(),
      'sections', jsonb_build_array(
        jsonb_build_object(
          'type', 'summary', 'title', 'Cash Flow', 'visibility', 'shop',
          'metrics', jsonb_build_array(
            jsonb_build_object('label', 'Revenue', 'value', COALESCE(SUM(revenue_usd)::numeric / 100, 0), 'unit', 'USD'),
            jsonb_build_object('label', 'Expenses', 'value', COALESCE(SUM(expenses_usd)::numeric / 100, 0), 'unit', 'USD'),
            jsonb_build_object('label', 'Refunds', 'value', COALESCE(SUM(refunds_usd)::numeric / 100, 0), 'unit', 'USD'),
            jsonb_build_object('label', 'Net cash change', 'value',
              COALESCE((SUM(revenue_usd) - SUM(expenses_usd) - SUM(refunds_usd))::numeric / 100, 0), 'unit', 'USD')
          )
        )
      )
    ) INTO v_report_data
    FROM public.profit_cache
    WHERE shop_id = p_shop_id AND day >= p_period_start::date AND day < p_period_end::date;

  ELSIF p_report_type = 'weekly-summary' THEN
    -- profit_cache money columns are cents -- divide by 100. 'Profit' uses the
    -- complete formula (revenue - refunds) - (cogs - cogs_reversal) - expenses,
    -- matching readProfitCache.ts's profitUsd and profit-trend's per-day
    -- formula, not the incomplete revenue-cogs-only shape this branch
    -- previously used (WAFI-147B final-review I6).
    SELECT jsonb_build_object(
      'id', 'weekly-summary', 'name', 'Weekly Summary',
      'periodStart', p_period_start, 'periodEnd', p_period_end,
      'generatedAt', clock_timestamp(),
      'sections', jsonb_build_array(
        jsonb_build_object(
          'type', 'summary', 'title', 'Week over Week', 'visibility', 'shop',
          'metrics', jsonb_build_array(
            jsonb_build_object('label', 'Revenue', 'value', COALESCE(pc.revenue::numeric / 100, 0), 'unit', 'USD'),
            jsonb_build_object('label', 'Profit', 'value',
              COALESCE(((pc.revenue - pc.refunds) - (pc.cogs - pc.cogs_reversal))::numeric / 100, 0), 'unit', 'USD'),
            jsonb_build_object('label', 'Expenses', 'value', COALESCE(pc.expenses::numeric / 100, 0), 'unit', 'USD')
          )
        )
      )
    ) INTO v_report_data
    FROM (
      SELECT SUM(revenue_usd) AS revenue, SUM(cogs_usd) AS cogs, SUM(expenses_usd) AS expenses,
             SUM(refunds_usd) AS refunds, SUM(cogs_reversal_usd) AS cogs_reversal
      FROM public.profit_cache
      WHERE shop_id = p_shop_id AND day >= p_period_start::date AND day < p_period_end::date
    ) pc;

    -- The gated staff-ranking section, computed and stored SEPARATELY --
    -- never merged into v_report_data. This is the enforcement point for
    -- the whole split-table security model: if this branch is ever
    -- accidentally merged into v_report_data above, the security invariant
    -- is silently broken. See wafi147b_generate_report_snapshot.test.sql's
    -- "staff-section separation" assertions.
    SELECT jsonb_build_object(
      'type', 'detail', 'title', 'Staff Ranking', 'visibility', 'staff',
      'columns', jsonb_build_array(
        jsonb_build_object('key', 'name', 'label', 'Staff'),
        jsonb_build_object('key', 'revenueUsd', 'label', 'Revenue')
      ),
      'rows', COALESCE(jsonb_agg(jsonb_build_object('name', st.name, 'revenueUsd', ranked.revenue_usd)
                                 ORDER BY ranked.revenue_usd DESC), '[]'::jsonb)
    ) INTO v_staff_section
    FROM (
      SELECT s.staff_id, SUM(s.total_usd) AS revenue_usd
      FROM public.sales s
      WHERE s.shop_id = p_shop_id AND s.staff_id IS NOT NULL
        AND s.created_at >= p_period_start AND s.created_at < p_period_end
      GROUP BY s.staff_id
    ) ranked
    JOIN public.staff st ON st.id = ranked.staff_id;

  ELSE
    RAISE EXCEPTION 'generate_report_snapshot: report_type % not yet implemented (see Task 6)', p_report_type;
  END IF;

  -- Atomic: main snapshot + (if applicable) staff-section row + all
  -- recipient notifications, all in this one function's transaction.
  INSERT INTO public.generated_reports
    (shop_id, report_type, period_start, period_end, scheduled_for, report_schema_version, report_data)
  VALUES (p_shop_id, p_report_type, p_period_start, p_period_end, p_scheduled_for, 1, v_report_data)
  RETURNING id INTO v_new_id;

  IF v_staff_section IS NOT NULL THEN
    INSERT INTO public.generated_report_staff_sections
      (generated_report_id, shop_id, section_data)
    VALUES (v_new_id, p_shop_id, v_staff_section);
  END IF;

  -- Notification fan-out: every staff member (or the owner) with
  -- can_view_reports for this shop, one row per recipient, idempotent on
  -- (entity_id, recipient_staff_id) via the Task 3 partial index.
  FOR v_recipient IN
    SELECT st.id AS staff_id FROM public.staff st
    WHERE st.shop_id = p_shop_id AND st.is_active = true
      AND (st.role = 'owner' OR (st.permissions::jsonb ->> 'can_view_reports')::boolean IS TRUE)
  LOOP
    INSERT INTO public.notifications
      (shop_id, recipient_staff_id, type, title, message, entity_type, entity_id, source_event_id)
    VALUES (
      p_shop_id::text, v_recipient.staff_id::text, 'report_ready',
      'تقرير جديد جاهز', 'تم إنشاء تقرير ' || p_report_type,
      'generated_report', v_new_id::text, NULL
    )
    ON CONFLICT (entity_id, recipient_staff_id) WHERE type = 'report_ready' DO NOTHING;
  END LOOP;

  RETURN v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_report_snapshot(uuid, text, timestamptz, timestamptz, timestamptz) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public._wafi147b_expected_period(text, timestamptz) FROM public, anon, authenticated;
