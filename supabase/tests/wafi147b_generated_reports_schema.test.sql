-- supabase/tests/wafi147b_generated_reports_schema.test.sql
-- WAFI-147B: generated_reports snapshot table schema, constraints, and RLS.
-- Run via: npx supabase test db

BEGIN;
SELECT plan(9);

SELECT has_table('public', 'generated_reports', 'generated_reports table exists');
SELECT has_column('public', 'generated_reports', 'shop_id', 'has shop_id');
SELECT col_is_fk('public', 'generated_reports', 'shop_id', 'shop_id references shops');
SELECT col_not_null('public', 'generated_reports', 'report_type', 'report_type NOT NULL');
SELECT col_not_null('public', 'generated_reports', 'period_start', 'period_start NOT NULL');
SELECT col_not_null('public', 'generated_reports', 'period_end', 'period_end NOT NULL');
SELECT col_not_null('public', 'generated_reports', 'report_schema_version', 'report_schema_version NOT NULL');
SELECT col_not_null('public', 'generated_reports', 'report_data', 'report_data NOT NULL');

-- Fixture: create a test shop to satisfy FK constraint
INSERT INTO public.shops (id, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'Test Shop for WAFI-147B');

-- Test: period_start >= period_end is rejected by CHECK constraint
SELECT throws_ok(
  $$ INSERT INTO public.generated_reports
     (shop_id, report_type, period_start, period_end, report_schema_version, report_data)
     VALUES ('00000000-0000-0000-0000-000000000001', 'cash-flow',
             '2026-08-20 00:00:00+00', '2026-08-19 00:00:00+00', 1, '{}') $$,
  NULL, NULL,
  'period_start >= period_end is rejected by CHECK constraint'
);

SELECT * FROM finish();
ROLLBACK;
