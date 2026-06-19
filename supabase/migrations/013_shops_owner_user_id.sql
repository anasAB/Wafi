-- Wafi POS — Link a shop to its owning Supabase Auth account.
-- This column is the single source of truth the access-token hook reads to
-- inject the shop_id claim. Sub-project 2 (signup) will populate it; for now it
-- is set by hand on the seed shop. Safe + idempotent.

ALTER TABLE public.shops
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES auth.users(id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_shops_owner_user
  ON public.shops (owner_user_id)
  WHERE owner_user_id IS NOT NULL;
