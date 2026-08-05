-- 075_shops_discount_cap_update_policy.sql
-- Bug fix: shops has NO client UPDATE policy (migration 062 documented this
-- as intentional, since at the time shops had no owner-editable columns).
-- WAFI-100 (052_sale_discounts.sql) then added cashier_discount_cap_pct /
-- manager_discount_cap_pct as owner-editable settings on shops, but no policy
-- was added to allow the write. Effect: the owner's local PowerSync write to
-- shops succeeds optimistically, the upload to Supabase is rejected by RLS
-- (default-deny, no policy = no access), and the value reverts on next
-- reload/sync — it never actually persisted.
--
-- Fix: allow the owner to UPDATE their own shop row, but lock down every
-- column that must stay server-only (identity/provisioning columns, and the
-- already-protected `features` pack-flags column) via a trigger, the same
-- pattern migration 041 used for `features` alone.

DROP POLICY IF EXISTS shops_update_owner ON public.shops;
CREATE POLICY shops_update_owner ON public.shops
  FOR UPDATE TO authenticated, anon
  USING (id = (SELECT public.auth_shop_id()) AND public.auth_role() = 'owner')
  WITH CHECK (id = (SELECT public.auth_shop_id()) AND public.auth_role() = 'owner');

CREATE OR REPLACE FUNCTION public.protect_shop_server_only_columns()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Any request carrying a JWT (i.e. an end-user client, not our own
  -- server-side tooling) may not touch identity/provisioning columns or the
  -- pack-flags column — only cashier_discount_cap_pct / manager_discount_cap_pct
  -- and other future plain settings columns are meant to be owner-editable.
  IF coalesce(current_setting('request.jwt.claims', true), '') <> '' THEN
    NEW.owner_user_id := OLD.owner_user_id;
    NEW.created_at     := OLD.created_at;
    NEW.features       := OLD.features;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_protect_shop_features ON public.shops;
DROP TRIGGER IF EXISTS trg_protect_shop_server_only_columns ON public.shops;
CREATE TRIGGER trg_protect_shop_server_only_columns
  BEFORE UPDATE ON public.shops
  FOR EACH ROW EXECUTE FUNCTION public.protect_shop_server_only_columns();
