-- supabase/tests/wafi147b_generated_report_staff_sections_schema.test.sql
-- pgTAP tests for generated_report_staff_sections table schema, constraints, and RLS
--
-- Final-review I1: the RLS assertions below were a placeholder that never
-- actually seeded a row or switched session role -- this is the single most
-- important security assertion the whole staff/shop split-table design
-- depends on (100_wafi147b_generated_report_staff_sections.sql's raw
-- auth_role() = 'owner' policy), so it is written properly here: real
-- fixtures (owner + manager staff in one shop), a real generated_reports +
-- generated_report_staff_sections row, and session-role switching via the
-- same set_config('request.jwt.claims', ...) + SET LOCAL ROLE authenticated
-- idiom wafi122_role_enforcement.test.sql already established for this
-- codebase's RLS tests.
BEGIN;
SELECT plan(6);

SELECT has_table('public', 'generated_report_staff_sections', 'table exists');
SELECT col_is_fk('public', 'generated_report_staff_sections', 'generated_report_id',
  'generated_report_id references generated_reports');
SELECT col_is_fk('public', 'generated_report_staff_sections', 'shop_id',
  'shop_id references shops');
SELECT col_not_null('public', 'generated_report_staff_sections', 'section_data', 'section_data NOT NULL');

-- ============================================================
-- RLS fixtures (seeded as postgres, bypassing RLS)
-- ============================================================

INSERT INTO auth.users (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at, aud, role)
VALUES ('00000000-0000-0000-0000-000000000000', '99999999-9999-9999-9999-999999999992', 'owner-wafi147b-sections@test', crypt('x', gen_salt('bf')), now(), now(), now(), 'authenticated', 'authenticated');

INSERT INTO public.shops (id, owner_user_id, name) VALUES
  ('99999999-9999-9999-9999-999999999991', '99999999-9999-9999-9999-999999999992', 'Test Shop Sections');

INSERT INTO public.staff (id, shop_id, name, pin_hash, role, permissions) VALUES
  ('99999999-9999-9999-9999-999999999993', '99999999-9999-9999-9999-999999999991', 'Owner', 'x', 'owner', '{}'),
  ('99999999-9999-9999-9999-999999999994', '99999999-9999-9999-9999-999999999991', 'Manager', 'x', 'manager', '{"can_view_reports": true}');

INSERT INTO public.generated_reports
  (id, shop_id, report_type, period_start, period_end, scheduled_for, report_schema_version, report_data)
VALUES
  ('99999999-9999-9999-9999-999999999995', '99999999-9999-9999-9999-999999999991', 'weekly-summary',
   '2026-08-10 00:00:00+00', '2026-08-17 00:00:00+00', '2026-08-23 09:00:00+00', 1, '{}'::jsonb);

INSERT INTO public.generated_report_staff_sections (id, generated_report_id, shop_id, section_data)
VALUES
  ('99999999-9999-9999-9999-999999999996', '99999999-9999-9999-9999-999999999995',
   '99999999-9999-9999-9999-999999999991', '{"type":"detail","title":"Staff Ranking","visibility":"staff"}'::jsonb);

-- Owner session: same shop, active_role = owner -> policy's auth_role() =
-- 'owner' check passes -> the row is visible.
SELECT set_config('request.jwt.claims',
  '{"sub":"99999999-9999-9999-9999-999999999992","role":"authenticated","active_role":"owner","staff_id":"99999999-9999-9999-9999-999999999993"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.generated_report_staff_sections
   WHERE id = '99999999-9999-9999-9999-999999999996'),
  1,
  'owner session sees the staff-sections row'
);
RESET ROLE;

-- Manager session: same sub (shops.owner_user_id -> auth.uid() mapping is
-- per-account, not per-active_role), but active_role = manager -> the raw
-- auth_role() = 'owner' check in the policy denies, regardless of
-- can_view_reports being true on this manager's own permissions -- this is
-- the exact "policy uses a raw role check, not public.can()" invariant
-- 100_wafi147b_generated_report_staff_sections.sql's own comment documents.
SELECT set_config('request.jwt.claims',
  '{"sub":"99999999-9999-9999-9999-999999999992","role":"authenticated","active_role":"manager","staff_id":"99999999-9999-9999-9999-999999999994"}', true);
SET LOCAL ROLE authenticated;
SELECT is(
  (SELECT count(*)::int FROM public.generated_report_staff_sections
   WHERE id = '99999999-9999-9999-9999-999999999996'),
  0,
  'manager session sees zero staff-sections rows, despite can_view_reports=true'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
