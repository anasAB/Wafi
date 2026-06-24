-- Wafi POS — WAFI-055: atomic shop provisioning on signup.
--
-- The #1 failure to prevent (epic 2026-06-20, Decision 2): an auth account that
-- exists WITHOUT a linked shop. That state silently locks the owner out, because
-- RLS (auth_shop_id(), migration 015) and the PowerSync rules resolve the tenant
-- from shops.owner_user_id = auth.uid() — no shop row means no data, no recovery.
--
-- Fix: an AFTER INSERT trigger on auth.users that creates the shops row in the
-- SAME transaction as the user insert. If shop creation raises, the auth.users
-- insert rolls back with it — so signup either yields {account + shop} or nothing.
-- There is no half-created state to strand the owner.
--
-- The owner's `staff` row + PIN are NOT created here on purpose: staff.pin_hash is
-- NOT NULL and the PIN is chosen by the owner at first run (the existing
-- /setup-owner flow, which mints salt+hash locally and syncs up). Creating the
-- shop atomically is what removes the lockout risk; the PIN layer then completes
-- client-side against a shop that already exists. See ADR-007.
--
-- Safe + idempotent: re-running ADD COLUMN / CREATE OR REPLACE / DROP+CREATE TRIGGER
-- is a no-op on an already-migrated database.

-- Shop details captured at signup. Nullable: the brother's hand-seeded shop and
-- any pre-existing rows predate these columns and must keep working.
ALTER TABLE public.shops
  ADD COLUMN IF NOT EXISTS business_type TEXT,
  ADD COLUMN IF NOT EXISTS country       TEXT;

-- SECURITY DEFINER so the trigger can insert into public.shops regardless of the
-- (unprivileged) role that drives the auth insert. search_path is pinned to defeat
-- search-path injection (a SECURITY DEFINER hardening requirement).
CREATE OR REPLACE FUNCTION public.provision_shop_for_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_shop_name TEXT := NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data ->> 'shop_name', '')), '');
BEGIN
  -- Idempotency: never create a second shop for the same owner (the unique index
  -- uq_shops_owner_user would reject it anyway, but failing the whole signup over
  -- a retry would be worse than a no-op).
  IF EXISTS (SELECT 1 FROM public.shops WHERE owner_user_id = NEW.id) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.shops (name, owner_user_id, business_type, country)
  VALUES (
    COALESCE(v_shop_name, 'متجري'),  -- "My shop" — a sane default; the owner renames it in settings
    NEW.id,
    NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data ->> 'business_type', '')), ''),
    NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data ->> 'country', '')), '')
  );

  RETURN NEW;
END;
$$;

-- Recreate to stay idempotent across re-runs.
DROP TRIGGER IF EXISTS on_auth_user_created_provision_shop ON auth.users;
CREATE TRIGGER on_auth_user_created_provision_shop
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.provision_shop_for_new_user();
