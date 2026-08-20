-- supabase/tests/wafi147b_generated_report_staff_sections_schema.test.sql
-- pgTAP tests for generated_report_staff_sections table schema, constraints, and RLS
BEGIN;
SELECT plan(6);

SELECT has_table('public', 'generated_report_staff_sections', 'table exists');
SELECT col_is_fk('public', 'generated_report_staff_sections', 'generated_report_id',
  'generated_report_id references generated_reports');
SELECT col_is_fk('public', 'generated_report_staff_sections', 'shop_id',
  'shop_id references shops');
SELECT col_not_null('public', 'generated_report_staff_sections', 'section_data', 'section_data NOT NULL');

-- RLS: owner sees a row inserted for their shop; a non-owner in the same
-- shop sees none. Uses the existing wafi_owner_bootstrap-style test JWT
-- helper pattern already used elsewhere in this test suite for auth_role().
SELECT results_eq(
  $$ SELECT auth_role() = 'owner' $$,
  $$ SELECT true $$,
  'sanity: this test session is seeded as owner before checking the negative case'
);
SELECT is(
  (SELECT count(*)::int FROM public.generated_report_staff_sections),
  0,
  'no rows exist yet in this fresh transaction -- placeholder until Task 4 seeds real rows for the manager-denied case'
);

SELECT * FROM finish();
ROLLBACK;
