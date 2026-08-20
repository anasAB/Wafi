-- supabase/migrations/104_wafi147b_remaining_report_types.sql
-- WAFI-147B Task 6. CREATE OR REPLACE FUNCTION replaces the whole function
-- body, so this migration carries Task 4's cash-flow/weekly-summary branches
-- verbatim (from 102_wafi147b_generate_report_snapshot.sql) PLUS the
-- remaining 10 report_type branches added here, in the same IF/ELSIF chain.
--
-- Parity references (src/features/reports/definitions/<name>.ts) per branch:
--   daily-closing    -> dailyClosing.ts      (composite: Staff Performance, visibility:'staff')
--   inventory-health -> inventoryHealth.ts   (no gated section)
--   discount-report  -> discountReport.ts    (composite: By Staff, visibility:'staff')
--   returns-report   -> returnsReport.ts     (composite: By Staff, visibility:'staff')
--   credit-report    -> creditReport.ts      (no gated section)
--   dead-stock       -> deadStock.ts         (no gated section)
--   monthly-health   -> monthlyHealth.ts     (composite: Staff Performance Review, visibility:'staff')
--   profit-trend     -> profitTrend.ts       (no gated section)
--   top-customers    -> topCustomers.ts      (no gated section)
--   top-products     -> topProducts.ts       (no gated section)
--
-- Per the design spec's "What parity means" section and this task's brief,
-- these are reasonable representative SQL equivalents of each report's main
-- sections (real tables/columns, correct staff-section isolation for the
-- composite types) -- NOT byte-for-byte parity with 147A's client compute,
-- which is explicitly out of scope for this ticket.

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

  -- Compute the report.
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
    -- never merged into v_report_data.
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

  ELSIF p_report_type = 'daily-closing' THEN
    -- Parity ref: dailyClosing.ts. Sales Totals + Expenses from profit_cache
    -- (Sacred: readProfitCache's aggregate); gated Staff Performance section.
    -- profit_cache money columns are cents -- divide by 100.
    SELECT jsonb_build_object(
      'id', 'daily-closing', 'name', 'Daily Closing Report',
      'periodStart', p_period_start, 'periodEnd', p_period_end,
      'generatedAt', clock_timestamp(),
      'sections', jsonb_build_array(
        jsonb_build_object(
          'type', 'summary', 'title', 'Sales Totals', 'visibility', 'shop',
          'metrics', jsonb_build_array(
            jsonb_build_object('label', 'Total sales', 'value', COALESCE(pc.revenue::numeric / 100, 0), 'unit', 'USD'),
            jsonb_build_object('label', 'Transactions', 'value', COALESCE(pc.invoice_count, 0))
          )
        ),
        jsonb_build_object(
          'type', 'summary', 'title', 'Expenses', 'visibility', 'shop',
          'metrics', jsonb_build_array(
            jsonb_build_object('label', 'Expenses', 'value', COALESCE(pc.expenses::numeric / 100, 0), 'unit', 'USD')
          )
        )
      )
    ) INTO v_report_data
    FROM (
      SELECT SUM(revenue_usd) AS revenue, SUM(expenses_usd) AS expenses, SUM(invoice_count) AS invoice_count
      FROM public.profit_cache
      WHERE shop_id = p_shop_id AND day >= p_period_start::date AND day < p_period_end::date
    ) pc;

    SELECT jsonb_build_object(
      'type', 'detail', 'title', 'Staff Performance', 'visibility', 'staff',
      'columns', jsonb_build_array(
        jsonb_build_object('key', 'name', 'label', 'Staff'),
        jsonb_build_object('key', 'revenueUsd', 'label', 'Revenue')
      ),
      'rows', COALESCE(jsonb_agg(jsonb_build_object('name', st.name, 'revenueUsd', ranked.revenue_usd)), '[]'::jsonb)
    ) INTO v_staff_section
    FROM (
      SELECT s.staff_id, SUM(s.total_usd) AS revenue_usd
      FROM public.sales s
      WHERE s.shop_id = p_shop_id AND s.staff_id IS NOT NULL
        AND s.created_at >= p_period_start AND s.created_at < p_period_end
      GROUP BY s.staff_id
    ) ranked
    JOIN public.staff st ON st.id = ranked.staff_id;

  ELSIF p_report_type = 'inventory-health' THEN
    -- Parity ref: inventoryHealth.ts. No gated section. Low-stock alerts +
    -- current-snapshot valuation from products (current_stock/cost_price_usd
    -- reflect TODAY, not the period, matching the TS file's explicit labeling).
    SELECT jsonb_build_object(
      'id', 'inventory-health', 'name', 'Inventory Health Report',
      'periodStart', p_period_start, 'periodEnd', p_period_end,
      'generatedAt', clock_timestamp(),
      'sections', jsonb_build_array(
        jsonb_build_object(
          'type', 'summary', 'title', 'Inventory Overview (current snapshot)', 'visibility', 'shop',
          'metrics', jsonb_build_array(
            jsonb_build_object('label', 'Current inventory value', 'value', COALESCE(val.total, 0), 'unit', 'USD')
          )
        ),
        jsonb_build_object(
          'type', 'detail', 'title', 'Low Stock Alerts (current snapshot)', 'visibility', 'shop',
          'columns', jsonb_build_array(
            jsonb_build_object('key', 'nameAr', 'label', 'Product'),
            jsonb_build_object('key', 'currentStock', 'label', 'Stock'),
            jsonb_build_object('key', 'lowStockThreshold', 'label', 'Threshold')
          ),
          'rows', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'nameAr', p.name_ar, 'currentStock', p.current_stock, 'lowStockThreshold', p.low_stock_threshold
            ))
            FROM public.products p
            WHERE p.shop_id = p_shop_id AND p.deleted = 0
              AND p.low_stock_threshold IS NOT NULL AND p.current_stock <= p.low_stock_threshold
          ), '[]'::jsonb)
        )
      )
    ) INTO v_report_data
    FROM (
      SELECT SUM(current_stock * cost_price_usd) AS total
      FROM public.products WHERE shop_id = p_shop_id AND deleted = 0
    ) val;

  ELSIF p_report_type = 'discount-report' THEN
    -- Parity ref: discountReport.ts. Total Discounts from profit_cache; By
    -- Product from sale_line_items; gated By Staff section.
    -- profit_cache's discount_usd is cents -- divide by 100 (sale_line_items'
    -- discount_amount_usd below is already real dollars, no division).
    SELECT jsonb_build_object(
      'id', 'discount-report', 'name', 'Discount Report',
      'periodStart', p_period_start, 'periodEnd', p_period_end,
      'generatedAt', clock_timestamp(),
      'sections', jsonb_build_array(
        jsonb_build_object(
          'type', 'summary', 'title', 'Total Discounts', 'visibility', 'shop',
          'metrics', jsonb_build_array(
            jsonb_build_object('label', 'Total discount given', 'value', COALESCE(pc.discount::numeric / 100, 0), 'unit', 'USD')
          )
        ),
        jsonb_build_object(
          'type', 'detail', 'title', 'By Product', 'visibility', 'shop',
          'columns', jsonb_build_array(
            jsonb_build_object('key', 'nameAr', 'label', 'Product'),
            jsonb_build_object('key', 'discountUsd', 'label', 'Discount')
          ),
          'rows', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('nameAr', bp.name_ar, 'discountUsd', bp.discount_usd) ORDER BY bp.discount_usd DESC)
            FROM (
              SELECT p.name_ar, SUM(sli.discount_amount_usd) AS discount_usd
              FROM public.sale_line_items sli
              JOIN public.products p ON p.id = sli.product_id
              JOIN public.sales s ON s.id = sli.sale_id
              WHERE sli.shop_id = p_shop_id AND sli.discount_amount_usd > 0
                AND s.created_at >= p_period_start AND s.created_at < p_period_end
              GROUP BY p.name_ar
            ) bp
          ), '[]'::jsonb)
        )
      )
    ) INTO v_report_data
    FROM (
      SELECT SUM(discount_usd) AS discount
      FROM public.profit_cache
      WHERE shop_id = p_shop_id AND day >= p_period_start::date AND day < p_period_end::date
    ) pc;

    SELECT jsonb_build_object(
      'type', 'detail', 'title', 'By Staff', 'visibility', 'staff',
      'columns', jsonb_build_array(
        jsonb_build_object('key', 'name', 'label', 'Staff'),
        jsonb_build_object('key', 'discountUsd', 'label', 'Discount')
      ),
      'rows', COALESCE(jsonb_agg(jsonb_build_object('name', st.name, 'discountUsd', ranked.discount_usd)
                                 ORDER BY ranked.discount_usd DESC), '[]'::jsonb)
    ) INTO v_staff_section
    FROM (
      SELECT s.staff_id, SUM(s.sale_discount_amount_usd) AS discount_usd
      FROM public.sales s
      WHERE s.shop_id = p_shop_id AND s.staff_id IS NOT NULL
        AND s.created_at >= p_period_start AND s.created_at < p_period_end
      GROUP BY s.staff_id
    ) ranked
    JOIN public.staff st ON st.id = ranked.staff_id;

  ELSIF p_report_type = 'returns-report' THEN
    -- Parity ref: returnsReport.ts. Total Returns + By Product/Reason from
    -- returns/return_line_items; gated By Staff section (staff who PROCESSED
    -- the return, via cashier_shifts.staff_id -- matches getStaffMetrics.ts's
    -- documented "processed by, not caused by" semantics).
    SELECT jsonb_build_object(
      'id', 'returns-report', 'name', 'Returns Report',
      'periodStart', p_period_start, 'periodEnd', p_period_end,
      'generatedAt', clock_timestamp(),
      'sections', jsonb_build_array(
        jsonb_build_object(
          'type', 'summary', 'title', 'Total Returns', 'visibility', 'shop',
          'metrics', jsonb_build_array(
            jsonb_build_object('label', 'Return count', 'value', COALESCE(pc.return_count, 0)),
            jsonb_build_object('label', 'Return value', 'value', COALESCE(pc.refunds::numeric / 100, 0), 'unit', 'USD')
          )
        ),
        jsonb_build_object(
          'type', 'detail', 'title', 'By Product', 'visibility', 'shop',
          'columns', jsonb_build_array(
            jsonb_build_object('key', 'nameAr', 'label', 'Product'),
            jsonb_build_object('key', 'returnCount', 'label', 'Count'),
            jsonb_build_object('key', 'refundUsd', 'label', 'Refund')
          ),
          'rows', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('nameAr', bp.name_ar, 'returnCount', bp.return_count, 'refundUsd', bp.refund_usd) ORDER BY bp.refund_usd DESC)
            FROM (
              SELECT p.name_ar, COUNT(*) AS return_count, SUM(rli.qty_returned * rli.unit_price_usd) AS refund_usd
              FROM public.return_line_items rli
              JOIN public.returns r ON r.id = rli.return_id
              JOIN public.products p ON p.id = rli.product_id
              WHERE r.shop_id = p_shop_id AND r.created_at >= p_period_start AND r.created_at < p_period_end
              GROUP BY p.name_ar
            ) bp
          ), '[]'::jsonb)
        ),
        jsonb_build_object(
          'type', 'detail', 'title', 'Return Reasons', 'visibility', 'shop',
          'columns', jsonb_build_array(
            jsonb_build_object('key', 'reason', 'label', 'Reason'),
            jsonb_build_object('key', 'count', 'label', 'Count')
          ),
          'rows', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('reason', br.reason, 'count', br.cnt) ORDER BY br.cnt DESC)
            FROM (
              SELECT COALESCE(r.reason, 'unspecified') AS reason, COUNT(*) AS cnt
              FROM public.returns r
              WHERE r.shop_id = p_shop_id AND r.created_at >= p_period_start AND r.created_at < p_period_end
              GROUP BY COALESCE(r.reason, 'unspecified')
            ) br
          ), '[]'::jsonb)
        )
      )
    ) INTO v_report_data
    FROM (
      SELECT SUM(return_count) AS return_count, SUM(refunds_usd) AS refunds
      FROM public.profit_cache
      WHERE shop_id = p_shop_id AND day >= p_period_start::date AND day < p_period_end::date
    ) pc;

    SELECT jsonb_build_object(
      'type', 'detail', 'title', 'By Staff', 'visibility', 'staff',
      'columns', jsonb_build_array(
        jsonb_build_object('key', 'name', 'label', 'Staff'),
        jsonb_build_object('key', 'returnCount', 'label', 'Count'),
        jsonb_build_object('key', 'returnRevenueUsd', 'label', 'Refund')
      ),
      'rows', COALESCE(jsonb_agg(jsonb_build_object('name', st.name, 'returnCount', ranked.return_count, 'returnRevenueUsd', ranked.refund_usd)
                                 ORDER BY ranked.refund_usd DESC), '[]'::jsonb)
    ) INTO v_staff_section
    FROM (
      SELECT cs.staff_id, COUNT(*) AS return_count, SUM(r.refund_amount_usd) AS refund_usd
      FROM public.returns r
      JOIN public.cashier_shifts cs ON cs.id = r.shift_id
      WHERE r.shop_id = p_shop_id AND cs.staff_id IS NOT NULL
        AND r.created_at >= p_period_start AND r.created_at < p_period_end
      GROUP BY cs.staff_id
    ) ranked
    JOIN public.staff st ON st.id = ranked.staff_id;

  ELSIF p_report_type = 'credit-report' THEN
    -- Parity ref: creditReport.ts. No gated section. As-of-period-end
    -- balance per customer (simplified from getCustomerAgingSnapshot.ts's
    -- full 4-term formula: credit sales - payments - returns on credit sales,
    -- all bounded to <= p_period_end), bucketed by days outstanding.
    SELECT jsonb_build_object(
      'id', 'credit-report', 'name', 'Credit Report',
      'periodStart', p_period_start, 'periodEnd', p_period_end,
      'generatedAt', clock_timestamp(),
      'sections', jsonb_build_array(
        jsonb_build_object(
          'type', 'summary', 'title', 'Outstanding Credit', 'visibility', 'shop',
          'metrics', jsonb_build_array(
            jsonb_build_object('label', 'Total outstanding', 'value', COALESCE((
              SELECT SUM(bal.balance_usd) FROM (
                SELECT c.id,
                  COALESCE((SELECT SUM(s.total_usd) FROM public.sales s WHERE s.customer_id = c.id AND s.is_credit = 1 AND s.shop_id = p_shop_id AND s.created_at < p_period_end), 0)
                  - COALESCE((SELECT SUM(cp.amount_usd) FROM public.customer_payments cp WHERE cp.customer_id = c.id AND cp.shop_id = p_shop_id AND cp.paid_at < p_period_end::date), 0)
                  - COALESCE((SELECT SUM(r.refund_amount_usd) FROM public.returns r JOIN public.sales s2 ON s2.id = r.original_sale_id WHERE s2.customer_id = c.id AND s2.is_credit = 1 AND r.shop_id = p_shop_id AND r.created_at < p_period_end), 0)
                  AS balance_usd
                FROM public.customers c WHERE c.shop_id = p_shop_id AND c.deleted = 0
              ) bal WHERE bal.balance_usd > 0.001
            ), 0), 'unit', 'USD')
          )
        ),
        jsonb_build_object(
          'type', 'detail', 'title', 'Overdue Accounts', 'visibility', 'shop',
          'columns', jsonb_build_array(
            jsonb_build_object('key', 'customerName', 'label', 'Customer'),
            jsonb_build_object('key', 'balanceUsd', 'label', 'Owed')
          ),
          'rows', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('customerName', d.name, 'balanceUsd', d.balance_usd) ORDER BY d.balance_usd DESC)
            FROM (
              SELECT c.id, c.name,
                COALESCE((SELECT SUM(s.total_usd) FROM public.sales s WHERE s.customer_id = c.id AND s.is_credit = 1 AND s.shop_id = p_shop_id AND s.created_at < p_period_end), 0)
                - COALESCE((SELECT SUM(cp.amount_usd) FROM public.customer_payments cp WHERE cp.customer_id = c.id AND cp.shop_id = p_shop_id AND cp.paid_at < p_period_end::date), 0)
                - COALESCE((SELECT SUM(r.refund_amount_usd) FROM public.returns r JOIN public.sales s2 ON s2.id = r.original_sale_id WHERE s2.customer_id = c.id AND s2.is_credit = 1 AND r.shop_id = p_shop_id AND r.created_at < p_period_end), 0)
                AS balance_usd
              FROM public.customers c WHERE c.shop_id = p_shop_id AND c.deleted = 0
            ) d WHERE d.balance_usd > 0.001
          ), '[]'::jsonb)
        )
      )
    ) INTO v_report_data;

  ELSIF p_report_type = 'dead-stock' THEN
    -- Parity ref: deadStock.ts. No gated section. Products with current_stock > 0
    -- and no sale (or none since threshold), current-snapshot valuation --
    -- same 90-day default as queryDeadStockRows.ts.
    SELECT jsonb_build_object(
      'id', 'dead-stock', 'name', 'Dead Stock Report',
      'periodStart', p_period_start, 'periodEnd', p_period_end,
      'generatedAt', clock_timestamp(),
      'sections', jsonb_build_array(
        jsonb_build_object(
          'type', 'summary', 'title', 'Capital Tied Up (current snapshot)', 'visibility', 'shop',
          'metrics', jsonb_build_array(
            jsonb_build_object('label', 'Capital in dead stock (90+ days)', 'value', COALESCE(ds.total_value, 0), 'unit', 'USD')
          )
        ),
        jsonb_build_object(
          'type', 'detail', 'title', 'Products with No Sales in 90+ Days (current snapshot)', 'visibility', 'shop',
          'columns', jsonb_build_array(
            jsonb_build_object('key', 'nameAr', 'label', 'Product'),
            jsonb_build_object('key', 'currentStock', 'label', 'Stock'),
            jsonb_build_object('key', 'valueUsd', 'label', 'Value')
          ),
          'rows', COALESCE(ds.rows, '[]'::jsonb)
        )
      )
    ) INTO v_report_data
    FROM (
      SELECT SUM(p.current_stock * p.cost_price_usd) AS total_value,
             jsonb_agg(jsonb_build_object('nameAr', p.name_ar, 'currentStock', p.current_stock, 'valueUsd', p.current_stock * p.cost_price_usd)
                       ORDER BY p.current_stock * p.cost_price_usd DESC) AS rows
      FROM public.products p
      LEFT JOIN (
        SELECT sli.product_id, MAX(s.created_at) AS last_sold_at
        FROM public.sale_line_items sli JOIN public.sales s ON s.id = sli.sale_id
        WHERE sli.shop_id = p_shop_id GROUP BY sli.product_id
      ) ls ON ls.product_id = p.id
      WHERE p.shop_id = p_shop_id AND p.deleted = 0 AND p.current_stock > 0 AND p.cost_price_usd > 0
        AND (ls.last_sold_at IS NULL OR ls.last_sold_at < now() - interval '90 days')
    ) ds;

  ELSIF p_report_type = 'monthly-health' THEN
    -- Parity ref: monthlyHealth.ts. P&L summary from profit_cache; Top 10
    -- Products/Customers; gated Staff Performance Review section.
    -- profit_cache money columns are cents -- divide by 100. 'Net profit'
    -- uses the complete formula (revenue - refunds) - (cogs - cogs_reversal)
    -- - expenses, matching readProfitCache.ts's profitUsd and profit-trend's
    -- per-day formula (WAFI-147B final-review I6).
    SELECT jsonb_build_object(
      'id', 'monthly-health', 'name', 'Monthly Business Health',
      'periodStart', p_period_start, 'periodEnd', p_period_end,
      'generatedAt', clock_timestamp(),
      'sections', jsonb_build_array(
        jsonb_build_object(
          'type', 'summary', 'title', 'P&L Summary', 'visibility', 'shop',
          'metrics', jsonb_build_array(
            jsonb_build_object('label', 'Revenue', 'value', COALESCE(pc.revenue::numeric / 100, 0), 'unit', 'USD'),
            jsonb_build_object('label', 'COGS', 'value', COALESCE(pc.cogs::numeric / 100, 0), 'unit', 'USD'),
            jsonb_build_object('label', 'Gross profit', 'value', COALESCE((pc.revenue - pc.cogs)::numeric / 100, 0), 'unit', 'USD'),
            jsonb_build_object('label', 'Expenses', 'value', COALESCE(pc.expenses::numeric / 100, 0), 'unit', 'USD'),
            jsonb_build_object('label', 'Net profit', 'value',
              COALESCE(((pc.revenue - pc.refunds) - (pc.cogs - pc.cogs_reversal) - pc.expenses)::numeric / 100, 0), 'unit', 'USD')
          )
        ),
        jsonb_build_object(
          'type', 'summary', 'title', 'Inventory Valuation (current snapshot)', 'visibility', 'shop',
          'metrics', jsonb_build_array(
            jsonb_build_object('label', 'Current inventory value', 'value', COALESCE(val.total, 0), 'unit', 'USD')
          )
        ),
        jsonb_build_object(
          'type', 'detail', 'title', 'Top 10 Products', 'visibility', 'shop',
          'columns', jsonb_build_array(
            jsonb_build_object('key', 'nameAr', 'label', 'Product'),
            jsonb_build_object('key', 'value', 'label', 'Revenue')
          ),
          'rows', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('nameAr', tp.name_ar, 'value', tp.value) ORDER BY tp.value DESC)
            FROM (
              SELECT p.name_ar, SUM(sli.line_total_usd) AS value
              FROM public.sale_line_items sli JOIN public.products p ON p.id = sli.product_id JOIN public.sales s ON s.id = sli.sale_id
              WHERE sli.shop_id = p_shop_id AND s.created_at >= p_period_start AND s.created_at < p_period_end
              GROUP BY p.name_ar ORDER BY value DESC LIMIT 10
            ) tp
          ), '[]'::jsonb)
        ),
        jsonb_build_object(
          'type', 'detail', 'title', 'Top 10 Customers', 'visibility', 'shop',
          'columns', jsonb_build_array(
            jsonb_build_object('key', 'customerName', 'label', 'Customer'),
            jsonb_build_object('key', 'revenueUsd', 'label', 'Revenue')
          ),
          'rows', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('customerName', tc.name, 'revenueUsd', tc.revenue_usd) ORDER BY tc.revenue_usd DESC)
            FROM (
              SELECT c.name, SUM(s.total_usd) AS revenue_usd
              FROM public.sales s JOIN public.customers c ON c.id = s.customer_id
              WHERE s.shop_id = p_shop_id AND s.created_at >= p_period_start AND s.created_at < p_period_end
              GROUP BY c.name ORDER BY revenue_usd DESC LIMIT 10
            ) tc
          ), '[]'::jsonb)
        )
      )
    ) INTO v_report_data
    FROM (
      SELECT SUM(revenue_usd) AS revenue, SUM(cogs_usd) AS cogs, SUM(expenses_usd) AS expenses,
             SUM(refunds_usd) AS refunds, SUM(cogs_reversal_usd) AS cogs_reversal
      FROM public.profit_cache
      WHERE shop_id = p_shop_id AND day >= p_period_start::date AND day < p_period_end::date
    ) pc,
    (
      SELECT SUM(current_stock * cost_price_usd) AS total
      FROM public.products WHERE shop_id = p_shop_id AND deleted = 0
    ) val;

    SELECT jsonb_build_object(
      'type', 'detail', 'title', 'Staff Performance Review', 'visibility', 'staff',
      'columns', jsonb_build_array(
        jsonb_build_object('key', 'name', 'label', 'Staff'),
        jsonb_build_object('key', 'marginUsd', 'label', 'Margin')
      ),
      'rows', COALESCE(jsonb_agg(jsonb_build_object('name', st.name, 'marginUsd', ranked.margin_usd)
                                 ORDER BY ranked.margin_usd DESC), '[]'::jsonb)
    ) INTO v_staff_section
    FROM (
      SELECT s.staff_id,
             SUM(s.total_usd) - COALESCE(SUM(sli.quantity * sli.unit_cost_usd), 0) AS margin_usd
      FROM public.sales s
      LEFT JOIN public.sale_line_items sli ON sli.sale_id = s.id
      WHERE s.shop_id = p_shop_id AND s.staff_id IS NOT NULL
        AND s.created_at >= p_period_start AND s.created_at < p_period_end
      GROUP BY s.staff_id
    ) ranked
    JOIN public.staff st ON st.id = ranked.staff_id;

  ELSIF p_report_type = 'profit-trend' THEN
    -- Parity ref: profitTrend.ts. No gated section. Daily profit series from
    -- profit_cache -- money columns are bigint cents (086's own comment:
    -- "never float"), so both revenueUsd and the profitUsd formula below
    -- divide by 100 before emitting, matching readProfitCache.ts's
    -- cents-first-then-divide convention and profitTrend.ts's own /100
    -- (WAFI-147B final-review C3/I6: this is also the canonical complete
    -- profit formula every other profit_cache-derived branch now matches).
    SELECT jsonb_build_object(
      'id', 'profit-trend', 'name', 'Profit Trend Report',
      'periodStart', p_period_start, 'periodEnd', p_period_end,
      'generatedAt', clock_timestamp(),
      'sections', jsonb_build_array(
        jsonb_build_object(
          'type', 'detail', 'title', 'Daily Profit', 'visibility', 'shop',
          'columns', jsonb_build_array(
            jsonb_build_object('key', 'day', 'label', 'Day'),
            jsonb_build_object('key', 'revenueUsd', 'label', 'Revenue'),
            jsonb_build_object('key', 'profitUsd', 'label', 'Profit')
          ),
          'rows', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'day', pc.day,
              'revenueUsd', pc.revenue_usd::numeric / 100,
              'profitUsd', ((pc.revenue_usd - pc.refunds_usd) - (pc.cogs_usd - pc.cogs_reversal_usd) - pc.expenses_usd)::numeric / 100
            ) ORDER BY pc.day ASC)
            FROM public.profit_cache pc
            WHERE pc.shop_id = p_shop_id AND pc.day >= p_period_start::date AND pc.day < p_period_end::date
          ), '[]'::jsonb)
        )
      )
    ) INTO v_report_data;

  ELSIF p_report_type = 'top-customers' THEN
    -- Parity ref: topCustomers.ts. No gated section. Top 20 by revenue/visits
    -- + new customers this period (all bounded to p_period_start/p_period_end).
    SELECT jsonb_build_object(
      'id', 'top-customers', 'name', 'Top Customers Report',
      'periodStart', p_period_start, 'periodEnd', p_period_end,
      'generatedAt', clock_timestamp(),
      'sections', jsonb_build_array(
        jsonb_build_object(
          'type', 'detail', 'title', 'Top 20 by Revenue', 'visibility', 'shop',
          'columns', jsonb_build_array(
            jsonb_build_object('key', 'customerName', 'label', 'Customer'),
            jsonb_build_object('key', 'revenueUsd', 'label', 'Revenue')
          ),
          'rows', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('customerName', tc.name, 'revenueUsd', tc.revenue_usd, 'visitCount', tc.visit_count) ORDER BY tc.revenue_usd DESC)
            FROM (
              SELECT c.name, SUM(s.total_usd) AS revenue_usd, COUNT(*) AS visit_count
              FROM public.sales s JOIN public.customers c ON c.id = s.customer_id
              WHERE s.shop_id = p_shop_id AND s.created_at >= p_period_start AND s.created_at < p_period_end
              GROUP BY c.name ORDER BY revenue_usd DESC LIMIT 20
            ) tc
          ), '[]'::jsonb)
        ),
        jsonb_build_object(
          'type', 'detail', 'title', 'New Customers This Period', 'visibility', 'shop',
          'columns', jsonb_build_array(
            jsonb_build_object('key', 'customerName', 'label', 'Customer'),
            jsonb_build_object('key', 'createdAt', 'label', 'Joined')
          ),
          'rows', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('customerName', nc.name, 'createdAt', nc.created_at))
            FROM (
              SELECT c.name, c.created_at
              FROM public.customers c
              WHERE c.shop_id = p_shop_id AND c.created_at >= p_period_start AND c.created_at < p_period_end
              LIMIT 500
            ) nc
          ), '[]'::jsonb)
        )
      )
    ) INTO v_report_data;

  ELSIF p_report_type = 'top-products' THEN
    -- Parity ref: topProducts.ts. No gated section. Top 20 by revenue/qty/
    -- profit(gross)/discount/returned-units.
    SELECT jsonb_build_object(
      'id', 'top-products', 'name', 'Top Products Report',
      'periodStart', p_period_start, 'periodEnd', p_period_end,
      'generatedAt', clock_timestamp(),
      'sections', jsonb_build_array(
        jsonb_build_object(
          'type', 'detail', 'title', 'Top 20 by Revenue', 'visibility', 'shop',
          'columns', jsonb_build_array(
            jsonb_build_object('key', 'nameAr', 'label', 'Product'),
            jsonb_build_object('key', 'value', 'label', 'Value')
          ),
          'rows', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('nameAr', tp.name_ar, 'value', tp.value) ORDER BY tp.value DESC)
            FROM (
              SELECT p.name_ar, SUM(sli.line_total_usd) AS value
              FROM public.sale_line_items sli JOIN public.products p ON p.id = sli.product_id JOIN public.sales s ON s.id = sli.sale_id
              WHERE sli.shop_id = p_shop_id AND s.created_at >= p_period_start AND s.created_at < p_period_end
              GROUP BY p.name_ar ORDER BY value DESC LIMIT 20
            ) tp
          ), '[]'::jsonb)
        ),
        jsonb_build_object(
          'type', 'detail', 'title', 'Top 20 by Quantity Sold', 'visibility', 'shop',
          'columns', jsonb_build_array(
            jsonb_build_object('key', 'nameAr', 'label', 'Product'),
            jsonb_build_object('key', 'value', 'label', 'Value')
          ),
          'rows', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('nameAr', tp.name_ar, 'value', tp.value) ORDER BY tp.value DESC)
            FROM (
              SELECT p.name_ar, SUM(sli.quantity) AS value
              FROM public.sale_line_items sli JOIN public.products p ON p.id = sli.product_id JOIN public.sales s ON s.id = sli.sale_id
              WHERE sli.shop_id = p_shop_id AND s.created_at >= p_period_start AND s.created_at < p_period_end
              GROUP BY p.name_ar ORDER BY value DESC LIMIT 20
            ) tp
          ), '[]'::jsonb)
        ),
        jsonb_build_object(
          'type', 'detail', 'title', 'Most Returned (units)', 'visibility', 'shop',
          'columns', jsonb_build_array(
            jsonb_build_object('key', 'nameAr', 'label', 'Product'),
            jsonb_build_object('key', 'value', 'label', 'Value')
          ),
          'rows', COALESCE((
            SELECT jsonb_agg(jsonb_build_object('nameAr', tp.name_ar, 'value', tp.value) ORDER BY tp.value DESC)
            FROM (
              SELECT p.name_ar, SUM(rli.qty_returned) AS value
              FROM public.return_line_items rli JOIN public.products p ON p.id = rli.product_id JOIN public.returns r ON r.id = rli.return_id
              WHERE r.shop_id = p_shop_id AND r.created_at >= p_period_start AND r.created_at < p_period_end
              GROUP BY p.name_ar ORDER BY value DESC LIMIT 20
            ) tp
          ), '[]'::jsonb)
        )
      )
    ) INTO v_report_data;

  ELSE
    RAISE EXCEPTION 'generate_report_snapshot: report_type % not yet implemented', p_report_type;
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
