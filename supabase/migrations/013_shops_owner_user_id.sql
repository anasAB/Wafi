-- Wafi POS — Link a shop to its owning Supabase Auth account.
-- This column is the single source of truth for tenant scoping: RLS
-- (public.auth_shop_id(), migration 015), the PowerSync sync rules
-- (powersync.yaml), and the client (device.store.ts) all resolve the shop from
-- owner_user_id = auth.uid(). No JWT claim or access-token hook is involved.
-- Sub-project 2 (signup) will populate it; for now it is set by hand on the seed
-- shop. Safe + idempotent.

ALTER TABLE public.shops
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES auth.users(id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_shops_owner_user
  ON public.shops (owner_user_id)
  WHERE owner_user_id IS NOT NULL;
