-- WAFI-122: Identity & Access domain -- staff, devices RLS policies.
--
-- DISCOVERY STEP (required before applying this migration):
-- Since this agent has no live database access, the exact current policy names
-- on the `devices` table were not auto-discovered. The brief specifies that
-- migration 037 created the `devices` table after the 015 naming convention
-- was established, and the policy names may differ from the standard
-- _insert_all / _update_all pattern.
--
-- Before running the SQL below:
-- 1. In the Supabase SQL editor, run this discovery query:
--    SELECT policyname, cmd FROM pg_policies
--    WHERE schemaname='public' AND tablename='devices';
-- 2. Note the returned policyname values for INSERT and UPDATE operations.
-- 3. If they differ from 'devices_insert_all' and 'devices_update_all' (as
--    specified below), substitute the correct names in the DROP POLICY
--    statements below before executing this migration.
--
-- RESIDUAL RISK: If the DROP POLICY statements use incorrect names (because
-- the actual policy names differ and were not corrected), those old wrongly-
-- named policies will survive alongside the new ones, potentially creating
-- conflicting/overlapping RLS rules. After deployment, verify this did not
-- occur by running the verification query in Step 3 of the brief to confirm
-- only the expected new policies exist.
--
-- device_sessions is intentionally NOT touched here. It holds no PII beyond
-- active_staff_id/active_role, already has shop-scoped SELECT-only access
-- (migration 044), and all writes already go exclusively through the
-- switch_active_operator() SECURITY DEFINER RPC (which re-verifies the PIN
-- and the shop boundary itself). Narrowing its SELECT further by role would
-- need a device-identity JWT claim that does not currently exist (048
-- removed the device_id claim in favor of session_id) -- deferred rather
-- than guessed at here.
--
-- Simplification vs. the design spec: managers get FULL column access on
-- staff (not a pin_hash/pin_salt/recovery_codes-redacted view). RLS is
-- row-level, not column-level; column masking would require a
-- security-barrier view, which changes what PowerSync (querying the base
-- table directly) delivers on sync -- explicitly flagged as risky by the
-- WAFI-201 PowerSync investigation (out of scope for this ticket). The
-- ticket's literal AC only requires blocking CASHIER entirely from staff,
-- which this migration does. Manager column redaction is deferred as a
-- named follow-up, not silently dropped.

DROP POLICY IF EXISTS staff_select_all ON public.staff;
DROP POLICY IF EXISTS staff_insert_all ON public.staff;
DROP POLICY IF EXISTS staff_update_all ON public.staff;
DROP POLICY IF EXISTS staff_delete_all ON public.staff;

CREATE POLICY staff_select_owner_manager ON public.staff
  FOR SELECT TO authenticated, anon
  USING (
    shop_id = (SELECT public.auth_shop_id())
    AND public.auth_role() IN ('owner', 'manager')
  );

CREATE POLICY staff_insert_owner ON public.staff
  FOR INSERT TO authenticated, anon
  WITH CHECK (
    shop_id = (SELECT public.auth_shop_id())
    AND public.auth_role() = 'owner'
  );

CREATE POLICY staff_update_owner ON public.staff
  FOR UPDATE TO authenticated, anon
  USING (
    shop_id = (SELECT public.auth_shop_id())
    AND public.auth_role() = 'owner'
  )
  WITH CHECK (
    shop_id = (SELECT public.auth_shop_id())
    AND public.auth_role() = 'owner'
  );

-- No DELETE policy created: with RLS enabled and no policy for a command,
-- that command is denied outright. staff.id rows are deactivated
-- (is_active = false), never hard-deleted (INV per design spec §5.1).

-- devices: replace INSERT/UPDATE with owner-only. Use the exact policy
-- names discovered in the discovery step above if they differ from the ones
-- specified below.
DROP POLICY IF EXISTS devices_insert_all ON public.devices;
DROP POLICY IF EXISTS devices_update_all ON public.devices;

CREATE POLICY devices_insert_owner ON public.devices
  FOR INSERT TO authenticated, anon
  WITH CHECK (
    shop_id = (SELECT public.auth_shop_id())
    AND public.auth_role() = 'owner'
  );

CREATE POLICY devices_update_owner ON public.devices
  FOR UPDATE TO authenticated, anon
  USING (
    shop_id = (SELECT public.auth_shop_id())
    AND public.auth_role() = 'owner'
  )
  WITH CHECK (
    shop_id = (SELECT public.auth_shop_id())
    AND public.auth_role() = 'owner'
  );

-- devices SELECT policy is left as-is (existing shop-scoped, all-roles
-- access) -- device list visibility for troubleshooting is not sensitive.
