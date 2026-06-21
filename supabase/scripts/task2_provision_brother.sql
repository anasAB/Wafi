-- Task 2 — Link the brother's account to his shop, then verify isolation.
-- Run in the Supabase SQL editor AFTER creating his auth user
-- (Authentication → Users → Add user, Auto Confirm ON) and copying his user id.
--
-- This is the runnable form of the Task 2 runbook steps 2–4. Run each numbered
-- section on its own. Replace <HIS_UID> in SECTION 1 with the new user's uuid —
-- it is the ONLY value you paste; sections 2 and 3 derive it from the shop.

-- ── SECTION 1 — Link the shop (commits) ─────────────────────────────────────
-- Expect: UPDATE 1. If UPDATE 0, the seed shop is missing — run supabase/seed.sql
-- first (it inserts shop 00000000-0000-0000-0000-000000000001), then re-run this.
update public.shops
   set owner_user_id = '<HIS_UID>'
 where id = '00000000-0000-0000-0000-000000000001';

-- ── SECTION 2 — Verify the mapping (read-only) ──────────────────────────────
-- Expect: exactly one row, owner_user_id = his uid. If owner_user_id is NULL the
-- account would silently see none of its own data — fix before trusting the build.
select id, name, owner_user_id
  from public.shops
 where id = '00000000-0000-0000-0000-000000000001';

-- ── SECTION 3 — Verify isolation under RLS, without a second device ─────────
-- Impersonates the linked owner as the `authenticated` role inside a transaction
-- that is ROLLED BACK, so it changes nothing. The BEGIN/ROLLBACK wrapper is
-- REQUIRED: `set local` only takes effect inside a transaction block, and the SQL
-- editor otherwise runs as the BYPASSRLS `postgres` role (which would see every
-- shop's rows and make this check meaningless).
--
-- The jwt claim is set BEFORE switching role, while still `postgres`, so the
-- subquery can read shops to find the uid (once `authenticated`, RLS would hide
-- it until the claim is in place).
begin;
  select set_config(
    'request.jwt.claims',
    json_build_object(
      'sub',  (select owner_user_id::text from public.shops where id = '00000000-0000-0000-0000-000000000001'),
      'role', 'authenticated'
    )::text,
    true  -- is_local: scoped to this transaction
  );
  set local role authenticated;

  -- Expect: resolved_shop = …0001, and counts cover ONLY his rows.
  select public.auth_shop_id()                as resolved_shop;
  select count(*)                             as visible_sales     from public.sales;
  select count(*)                             as visible_products  from public.products;
  select count(distinct shop_id)              as distinct_shops    from public.products;  -- expect 0 or 1, never >1

  -- Optional: prove a cross-tenant write is rejected. Uncomment to test; it raises
  -- a row-level-security error (caught by the savepoint so the script continues).
  -- savepoint try_foreign;
  -- insert into public.products (id, shop_id, name_ar, price_usd, cost_price_usd, current_stock, low_stock_threshold)
  --   values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000ff', 'should fail', 1, 0, 0, 0);
  -- rollback to savepoint try_foreign;  -- only reached if the insert WRONGLY succeeded
rollback;
