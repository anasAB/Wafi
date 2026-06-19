-- Wafi POS — Replace permissive RLS (USING true) with per-shop scoping.
-- Reads the shop_id claim injected by the access-token hook (migration 014).
-- Covers every synced table, including products/staff/audit_log (previously
-- USING true from 005/006/008). Idempotent: drops old policies, recreates scoped.
--
-- PRECONDITION: apply ONLY after verifying the access token carries a shop_id
-- claim (see migration 014 / plan Task 2 gate). Applying without the claim
-- present denies all access and locks the account out of its own data.

create or replace function public.auth_shop_id()
returns uuid
language sql
stable
as $$ select nullif(auth.jwt() ->> 'shop_id', '')::uuid $$;

do $$
declare
  t text;
  tables text[] := array[
    'products','stock_adjustments','sales','sale_line_items','exchange_rates',
    'expenses','customers','customer_payments','receipt_settings','sale_payments',
    'staff','cashier_shifts','returns','return_line_items','return_reasons',
    'audit_log','suppliers','stock_receivings','stock_receiving_line_items'
  ];
  p text;
begin
  foreach t in array tables loop
    if exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t and c.relkind = 'r'
    ) then
      execute format('alter table public.%I enable row level security', t);

      -- Drop any prior policies we created (permissive or scoped) so this is re-runnable.
      foreach p in array array['_select_all','_insert_all','_update_all','_delete_all'] loop
        execute format('drop policy if exists %I on public.%I', t || p, t);
      end loop;

      execute format(
        'create policy %I on public.%I for select to anon, authenticated using (shop_id = public.auth_shop_id())',
        t || '_select_all', t);
      execute format(
        'create policy %I on public.%I for insert to anon, authenticated with check (shop_id = public.auth_shop_id())',
        t || '_insert_all', t);
      execute format(
        'create policy %I on public.%I for update to anon, authenticated using (shop_id = public.auth_shop_id()) with check (shop_id = public.auth_shop_id())',
        t || '_update_all', t);
      execute format(
        'create policy %I on public.%I for delete to anon, authenticated using (shop_id = public.auth_shop_id())',
        t || '_delete_all', t);
    end if;
  end loop;
end $$;
