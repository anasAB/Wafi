-- supabase/migrations/100_wafi147b_generated_report_staff_sections.sql
-- WAFI-147B. Holds ONLY the visibility:'staff' section content for the 5
-- composite report types (daily-closing, weekly-summary, monthly-health,
-- discount-report, returns-report -- verified directly against
-- src/features/reports/definitions/*.ts, not assumed). RLS uses a raw
-- auth_role() check, NOT public.can('can_view_staff_performance') -- see
-- design spec "Read authorization": permissionsForRole() in
-- src/features/staff/staff.types.ts does not trust the stored permissions
-- blob for this flag on non-owners, so neither does this policy.

CREATE TABLE IF NOT EXISTS public.generated_report_staff_sections (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  generated_report_id   uuid NOT NULL REFERENCES public.generated_reports(id),
  shop_id               uuid NOT NULL REFERENCES public.shops(id),
  section_data          jsonb NOT NULL,
  UNIQUE (generated_report_id)
);

ALTER TABLE public.generated_report_staff_sections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS generated_report_staff_sections_select_owner_only
  ON public.generated_report_staff_sections;
CREATE POLICY generated_report_staff_sections_select_owner_only
  ON public.generated_report_staff_sections
  FOR SELECT TO authenticated, anon
  USING (
    shop_id = (SELECT public.auth_shop_id())
    AND (SELECT public.auth_role()) = 'owner'
  );

REVOKE INSERT, UPDATE, DELETE ON TABLE public.generated_report_staff_sections FROM anon, authenticated;
GRANT SELECT ON TABLE public.generated_report_staff_sections TO anon, authenticated;
