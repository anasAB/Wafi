-- WAFI-147B: pg_cron job scheduling
-- Three fixed UTC schedules per the design spec's Schedule scope table.
-- These calls assume:
-- 1. pg_cron extension is installed (guarded below, so this migration is
--    safely re-runnable even on a project where it wasn't enabled yet)
-- 2. cron.timezone is set to UTC (see Step 1 verification)
-- 3. The executing role has permissions to call cron.schedule (see Step 1/2)
--
-- Verify against the live project after applying (Step 4):
-- SELECT jobid, jobname, schedule, command FROM cron.job WHERE jobname LIKE 'wafi147b_%';

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Idempotent re-apply: unschedule-if-exists before each cron.schedule call,
-- so re-running this migration (e.g. after a rollback/replay) never fails
-- or double-schedules a job (final-review I4).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wafi147b_daily_reports') THEN
    PERFORM cron.unschedule('wafi147b_daily_reports');
  END IF;
END $$;

SELECT cron.schedule(
  'wafi147b_daily_reports',
  '0 0 * * *', -- 00:00 UTC daily
  $$ SELECT public.generate_scheduled_reports('daily') $$
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wafi147b_weekly_reports') THEN
    PERFORM cron.unschedule('wafi147b_weekly_reports');
  END IF;
END $$;

SELECT cron.schedule(
  'wafi147b_weekly_reports',
  '0 9 * * 0', -- Sunday 09:00 UTC
  $$ SELECT public.generate_scheduled_reports('weekly') $$
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wafi147b_monthly_reports') THEN
    PERFORM cron.unschedule('wafi147b_monthly_reports');
  END IF;
END $$;

SELECT cron.schedule(
  'wafi147b_monthly_reports',
  '0 9 1 * *', -- 1st of month 09:00 UTC
  $$ SELECT public.generate_scheduled_reports('monthly') $$
);
