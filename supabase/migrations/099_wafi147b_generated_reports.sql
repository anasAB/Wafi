-- supabase/migrations/099_wafi147b_generated_reports.sql
-- WAFI-147B. Main scheduled-report snapshot table. See design spec
-- "Persisted artifact" and "Read authorization" for the full rationale.
-- report_type is constrained to ONLY the 12 wall-clock report types this
-- ticket implements -- Employee Summary ('employee-summary') is deliberately
-- excluded; its snapshot identity needs a staff_id/shift_id dimension this
-- table does not have (see the follow-up ticket noted in the design spec).

CREATE TABLE IF NOT EXISTS public.generated_reports (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id               uuid NOT NULL REFERENCES public.shops(id),
  report_type           text NOT NULL CHECK (report_type IN (
                           'daily-closing', 'cash-flow',
                           'weekly-summary', 'inventory-health', 'discount-report',
                           'returns-report', 'credit-report', 'dead-stock',
                           'monthly-health', 'profit-trend', 'top-customers', 'top-products'
                         )),
  period_start          timestamptz NOT NULL,
  period_end            timestamptz NOT NULL,
  scheduled_for         timestamptz,
  generated_at          timestamptz NOT NULL DEFAULT clock_timestamp(),
  report_schema_version integer NOT NULL,
  report_data           jsonb NOT NULL,
  CHECK (period_start < period_end),
  UNIQUE (shop_id, report_type, period_start, period_end)
);

ALTER TABLE public.generated_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS generated_reports_select_scoped ON public.generated_reports;
CREATE POLICY generated_reports_select_scoped ON public.generated_reports
  FOR SELECT TO authenticated, anon
  USING (
    shop_id = (SELECT public.auth_shop_id())
    AND public.can('can_view_reports')
  );

-- No INSERT/UPDATE/DELETE policy for any client role -- immutable, server-only
-- writes via generate_report_snapshot() (Task 4). REVOKE explicitly rather
-- than relying on "no policy = no access" alone, matching this codebase's
-- existing precedent (086_profit_cache_apply.sql's REVOKE on its apply
-- function) of making the intent explicit, not implicit.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.generated_reports FROM anon, authenticated;
GRANT SELECT ON TABLE public.generated_reports TO anon, authenticated;
