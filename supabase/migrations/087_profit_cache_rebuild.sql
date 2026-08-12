-- supabase/migrations/087_profit_cache_rebuild.sql

-- WAFI-153. profit_cache's rebuild contract is full-shop-scope only (no
-- from/to), and is a full rematerialization (regenerate backfill, then
-- replay events) -- NOT "delete event-derived rows, replay, leave backfilled
-- rows alone." The costless-count decrement can mutate a DIFFERENT day's row
-- than its triggering event's own day, so a partial-range rebuild or a
-- "leave backfilled rows alone" rebuild can both corrupt state outside their
-- intended scope. See design spec's Rebuild section for the full argument.

-- Backfill-eligible sales/returns/expenses: a fact is eligible iff no
-- version-2-or-higher event for it has already been applied. This makes the
-- generator self-healing on every re-run and immune to device-upgrade-lag
-- date-cutoff gaps and mixed-version-day double-counting -- see design spec.
-- Never called standalone: it has no merge-safety story against a
-- possibly-nonempty scope, and none is needed, because rebuild_profit_cache_scope
-- always deletes the entire scope immediately before calling this.
CREATE OR REPLACE FUNCTION public._backfill_profit_cache_shop(p_shop_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_sale record;
  v_return record;
  v_expense record;
BEGIN
  -- Sales: revenue/cogs/discount/invoice_count/costless_sale_count, keyed by
  -- created_at's UTC date (backfilled rows have no shop-timezone-precise
  -- event_projection_day to reuse -- this is the same best-available-data
  -- limitation Plan 2 accepted for events.event_projection_day backfill).
  FOR v_sale IN
    SELECT s.id, s.shop_id, (s.created_at AT TIME ZONE 'UTC')::date AS day,
      s.total_usd, s.total_syp,
      COALESCE((SELECT SUM(sli.quantity * COALESCE(sli.unit_cost_usd, 0))
                FROM public.sale_line_items sli WHERE sli.sale_id = s.id), 0) AS cogs_usd,
      COALESCE(s.sale_discount_amount_usd, 0)
        + COALESCE((SELECT SUM(COALESCE(sli.discount_amount_usd, 0))
                    FROM public.sale_line_items sli WHERE sli.sale_id = s.id), 0) AS discount_usd,
      EXISTS (SELECT 1 FROM public.sale_line_items sli
              WHERE sli.sale_id = s.id AND (sli.unit_cost_usd IS NULL OR sli.unit_cost_usd = 0)) AS has_costless_line
    FROM public.sales s
    WHERE s.shop_id = p_shop_id
      AND NOT EXISTS (
        SELECT 1 FROM public.events e
        WHERE e.type = 'sale.completed' AND e.payload->>'saleId' = s.id::text
          AND e.payload_version >= 2
      )
  LOOP
    INSERT INTO public.profit_cache (shop_id, day, revenue_usd, revenue_syp, cogs_usd,
      discount_usd, invoice_count, costless_sale_count, source_event_id)
    VALUES (v_sale.shop_id, v_sale.day,
      ROUND(v_sale.total_usd::numeric * 100)::bigint,
      ROUND(v_sale.total_syp::numeric * 100)::bigint,
      ROUND(v_sale.cogs_usd::numeric * 100)::bigint,
      ROUND(v_sale.discount_usd::numeric * 100)::bigint,
      1, CASE WHEN v_sale.has_costless_line THEN 1 ELSE 0 END, NULL)
    ON CONFLICT (shop_id, day) DO UPDATE SET
      revenue_usd = profit_cache.revenue_usd + EXCLUDED.revenue_usd,
      revenue_syp = profit_cache.revenue_syp + EXCLUDED.revenue_syp,
      cogs_usd = profit_cache.cogs_usd + EXCLUDED.cogs_usd,
      discount_usd = profit_cache.discount_usd + EXCLUDED.discount_usd,
      invoice_count = profit_cache.invoice_count + 1,
      costless_sale_count = profit_cache.costless_sale_count + EXCLUDED.costless_sale_count,
      updated_at = now();
  END LOOP;

  -- Returns: refunds/cogs_reversal/return_count on the return's own day, plus
  -- the cross-day costless decrement on the ORIGINAL SALE's day -- same rule
  -- _apply_profit_cache uses, ported here for backfill-only facts.
  FOR v_return IN
    SELECT r.id, r.shop_id, (r.created_at AT TIME ZONE 'UTC')::date AS day,
      r.refund_amount_usd,
      COALESCE((SELECT SUM(rli.qty_returned * COALESCE(c.unit_cost_usd, 0))
                FROM public.return_line_items rli
                LEFT JOIN (
                  SELECT sale_id, product_id, AVG(unit_cost_usd) AS unit_cost_usd
                  FROM public.sale_line_items GROUP BY sale_id, product_id
                ) c ON c.sale_id = r.original_sale_id AND c.product_id = rli.product_id
                WHERE rli.return_id = r.id AND rli.restock = 1), 0) AS cogs_reversal_usd,
      (SELECT COUNT(*) = 0 FROM public.sale_line_items sli
       WHERE sli.sale_id = r.original_sale_id
         AND sli.quantity > COALESCE((SELECT SUM(rli2.qty_returned) FROM public.return_line_items rli2
                                       JOIN public.returns r2 ON r2.id = rli2.return_id
                                       WHERE r2.original_sale_id = r.original_sale_id
                                         AND rli2.product_id = sli.product_id), 0)
      ) AS is_full_return,
      EXISTS (SELECT 1 FROM public.sale_line_items sli
              WHERE sli.sale_id = r.original_sale_id AND (sli.unit_cost_usd IS NULL OR sli.unit_cost_usd = 0)) AS sale_was_costless,
      (SELECT (s.created_at AT TIME ZONE 'UTC')::date FROM public.sales s WHERE s.id = r.original_sale_id) AS original_sale_day
    FROM public.returns r
    WHERE r.shop_id = p_shop_id
      AND NOT EXISTS (
        SELECT 1 FROM public.events e
        WHERE e.type = 'sale.returned' AND e.payload->>'returnId' = r.id::text
          AND e.payload_version >= 2
      )
  LOOP
    INSERT INTO public.profit_cache (shop_id, day, refunds_usd, cogs_reversal_usd, return_count, source_event_id)
    VALUES (v_return.shop_id, v_return.day,
      ROUND(v_return.refund_amount_usd::numeric * 100)::bigint,
      ROUND(v_return.cogs_reversal_usd::numeric * 100)::bigint, 1, NULL)
    ON CONFLICT (shop_id, day) DO UPDATE SET
      refunds_usd = profit_cache.refunds_usd + EXCLUDED.refunds_usd,
      cogs_reversal_usd = profit_cache.cogs_reversal_usd + EXCLUDED.cogs_reversal_usd,
      return_count = profit_cache.return_count + 1,
      updated_at = now();

    IF v_return.is_full_return AND v_return.sale_was_costless AND v_return.original_sale_day IS NOT NULL THEN
      INSERT INTO public.profit_cache (shop_id, day, costless_sale_count, source_event_id)
      VALUES (v_return.shop_id, v_return.original_sale_day, -1, NULL)
      ON CONFLICT (shop_id, day) DO UPDATE SET
        costless_sale_count = profit_cache.costless_sale_count - 1,
        updated_at = now();
    END IF;
  END LOOP;

  -- Expenses: single amount, no cross-day concern.
  FOR v_expense IN
    SELECT e.id, e.shop_id, e.expense_date AS day, e.amount_usd
    FROM public.expenses e
    WHERE e.shop_id = p_shop_id
      AND NOT EXISTS (
        SELECT 1 FROM public.events ev
        WHERE ev.type = 'expense.recorded' AND ev.payload->>'expenseId' = e.id::text
          AND ev.payload_version >= 2
      )
  LOOP
    INSERT INTO public.profit_cache (shop_id, day, expenses_usd, source_event_id)
    VALUES (v_expense.shop_id, v_expense.day, ROUND(v_expense.amount_usd::numeric * 100)::bigint, NULL)
    ON CONFLICT (shop_id, day) DO UPDATE SET
      expenses_usd = profit_cache.expenses_usd + EXCLUDED.expenses_usd,
      updated_at = now();
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public._backfill_profit_cache_shop(uuid) FROM public;

CREATE OR REPLACE FUNCTION public.rebuild_profit_cache_scope(p_shop_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_event_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('profit_cache' || p_shop_id::text));

  DELETE FROM public.profit_cache WHERE shop_id = p_shop_id;
  DELETE FROM public.projection_processed_events
    WHERE projection_name = 'profit_cache'
      AND event_id IN (SELECT id FROM public.events WHERE shop_id = p_shop_id);

  -- Phase 1: regenerate the backfilled base against a now-provably-empty scope.
  PERFORM public._backfill_profit_cache_shop(p_shop_id);

  -- Phase 2: replay every event for this shop, in sequence order, on top of
  -- that clean base. Version-1 events no-op; version-2 events apply fully.
  FOR v_event_id IN
    SELECT id FROM public.events WHERE shop_id = p_shop_id ORDER BY sequence ASC
  LOOP
    PERFORM public._apply_profit_cache(v_event_id);
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rebuild_profit_cache_scope(uuid) TO service_role;
