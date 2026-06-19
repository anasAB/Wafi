-- Wafi POS — Staff table (owner + cashier)
-- Domain users for shop operations. Distinct from Supabase auth users.

CREATE TABLE IF NOT EXISTS public.staff (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     UUID NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  pin_hash    TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('owner', 'cashier')),
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_shop_active
  ON public.staff (shop_id, is_active, created_at);

-- At most one active owner per shop.
CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_one_active_owner_per_shop
  ON public.staff (shop_id)
  WHERE role = 'owner' AND is_active = true;

GRANT ALL ON TABLE public.staff TO anon, authenticated, service_role;
