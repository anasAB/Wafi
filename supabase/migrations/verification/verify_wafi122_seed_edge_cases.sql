-- Companion to verify_wafi122_role_enforcement.sql.
-- Seeds the edge-case rows that script's B3, B5, B6, and C2 blocks need but
-- this project's existing staff data doesn't have: a manager with malformed
-- permissions JSON, a manager with every permission flag false, and a
-- second shop with its own staff (for cross-tenant checks). Each section is
-- SETUP -> run the corresponding block in verify_wafi122_role_enforcement.sql
-- -> REVERT. Do not leave these rows in place after verification.

-- ============================================================
-- B3 setup: manager with malformed permissions JSON
-- ============================================================
-- Reuses the existing active manager row. Save the original value first.
SELECT id, permissions FROM public.staff
WHERE id = '16e0087b-a072-45fc-b87e-d1c2963838cb';
-- ^ copy the returned `permissions` value somewhere before proceeding --
--   you need it for the revert step below.

UPDATE public.staff
SET permissions = 'not valid json'
WHERE id = '16e0087b-a072-45fc-b87e-d1c2963838cb';

-- Now run B3 from verify_wafi122_role_enforcement.sql with:
--   <manager_with_malformed_permissions_staff_id> = 16e0087b-a072-45fc-b87e-d1c2963838cb

-- B3 revert (paste the original permissions JSON you copied above):
-- UPDATE public.staff
-- SET permissions = '<paste original JSON back here>'
-- WHERE id = '16e0087b-a072-45fc-b87e-d1c2963838cb';

-- ============================================================
-- B4 setup: deactivate the same manager (if not already covered)
-- ============================================================
UPDATE public.staff SET is_active = false
WHERE id = '16e0087b-a072-45fc-b87e-d1c2963838cb';

-- Now run B4 with:
--   <deactivated_manager_staff_id> = 16e0087b-a072-45fc-b87e-d1c2963838cb

-- B4 revert:
UPDATE public.staff SET is_active = true
WHERE id = '16e0087b-a072-45fc-b87e-d1c2963838cb';

-- ============================================================
-- B5 setup: manager with every permission flag explicitly false
-- ============================================================
-- Run the B3 revert first if you haven't, so permissions is valid JSON again,
-- then capture the current value before overwriting it:
SELECT id, permissions FROM public.staff
WHERE id = '16e0087b-a072-45fc-b87e-d1c2963838cb';
-- ^ copy this value for the B5 revert step.

-- Set every known permission flag to false. Adjust the key list to match
-- whatever flags actually exist in your `staff.permissions` schema --
-- check docs/architecture or the staff table's design doc if unsure which
-- flags are defined.
UPDATE public.staff
SET permissions = (
  SELECT jsonb_object_agg(key, 'false'::jsonb)
  FROM jsonb_each(permissions::jsonb)
)::text
WHERE id = '16e0087b-a072-45fc-b87e-d1c2963838cb';

-- Now run B5 with:
--   <manager_all_flags_false_staff_id> = 16e0087b-a072-45fc-b87e-d1c2963838cb

-- B5 revert (paste the JSON captured just above):
-- UPDATE public.staff
-- SET permissions = '<paste original JSON back here>'
-- WHERE id = '16e0087b-a072-45fc-b87e-d1c2963838cb';

-- ============================================================
-- B6 / C2 setup: a second shop with its own owner + staff
-- ============================================================
-- Only needed if this project doesn't already have a second shop. Check
-- first:
SELECT id, owner_user_id, name FROM public.shops;

-- If only one shop exists, seed a throwaway second shop + owner + staff.
-- NOTE: shops.owner_user_id must reference a real row in auth.users --
-- you cannot invent a UUID here. Use an existing second auth user if you
-- have one (e.g. a test account), or create one via Supabase Auth first,
-- then substitute its id below.
--
-- INSERT INTO public.shops (owner_user_id, name)
-- VALUES ('<second_auth_user_id>', 'WAFI-122 verification shop B')
-- RETURNING id;
--
-- -- copy the returned shop id, then:
-- INSERT INTO public.staff (shop_id, role, is_active, permissions)
-- VALUES ('<shop_b_id>', 'cashier', true, '{}')
-- RETURNING id;
--
-- Use that returned staff id as both:
--   <other_shop_staff_id>            (B6)
--   <staff_id_from_a_different_shop> (C2)
--
-- Revert: delete the seeded rows once verification is done.
-- DELETE FROM public.staff WHERE shop_id = '<shop_b_id>';
-- DELETE FROM public.shops WHERE id = '<shop_b_id>';
