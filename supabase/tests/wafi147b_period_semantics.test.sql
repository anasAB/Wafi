-- supabase/tests/wafi147b_period_semantics.test.sql
-- WAFI-147B. Boundary-correctness tests for _wafi147b_expected_period.
-- Ensures daily/weekly/monthly period semantics match the design spec,
-- and rejection tests confirm unknown report types are properly rejected.

BEGIN;
SELECT plan(4);

-- Daily: 2026-08-20 00:00 UTC trigger -> [2026-08-19 00:00, 2026-08-20 00:00)
SELECT results_eq(
  $$ SELECT period_start, period_end FROM public._wafi147b_expected_period('cash-flow', '2026-08-20 00:00:00+00') $$,
  $$ VALUES ('2026-08-19 00:00:00+00'::timestamptz, '2026-08-20 00:00:00+00'::timestamptz) $$,
  'daily period is the previous UTC calendar day'
);

-- Weekly: Sunday 2026-08-23 09:00 UTC -> [2026-08-10 00:00, 2026-08-17 00:00)
-- (the design spec's own worked example -- the week that ended the day before)
SELECT results_eq(
  $$ SELECT period_start, period_end FROM public._wafi147b_expected_period('weekly-summary', '2026-08-23 09:00:00+00') $$,
  $$ VALUES ('2026-08-10 00:00:00+00'::timestamptz, '2026-08-17 00:00:00+00'::timestamptz) $$,
  'weekly period is the preceding completed Mon-Sun week, not the trigger day''s own week'
);

-- Monthly: 2026-09-01 09:00 UTC -> [2026-08-01 00:00, 2026-09-01 00:00)
SELECT results_eq(
  $$ SELECT period_start, period_end FROM public._wafi147b_expected_period('monthly-health', '2026-09-01 09:00:00+00') $$,
  $$ VALUES ('2026-08-01 00:00:00+00'::timestamptz, '2026-09-01 00:00:00+00'::timestamptz) $$,
  'monthly period is the previous full calendar month'
);

SELECT throws_ok(
  $$ SELECT * FROM public._wafi147b_expected_period('employee-summary', '2026-08-20 00:00:00+00') $$,
  NULL, NULL,
  'employee-summary has no wall-clock cadence and is rejected'
);

SELECT * FROM finish();
ROLLBACK;
