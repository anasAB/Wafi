-- Wafi POS — Replace permissive RLS (USING true) with per-shop scoping.
-- Scopes every row via public.auth_shop_id() — the shops.owner_user_id → auth.uid()
-- mapping (defined below). NO JWT claim and NO access-token hook are required:
-- auth.uid() (the token's `sub`) is always present. This matches the PowerSync
-- sync rules, which scope by the same owner_user_id mapping.
-- Covers every synced table, including products/staff/audit_log (previously
-- USING true from 005/006/008). Idempotent: drops old policies, recreates scoped.
--
-- PRECONDITION: each account must own exactly one shops row
-- (shops.owner_user_id = auth.users.id; see migration 013). An account with no
-- such row resolves auth_shop_id() to NULL and sees none of its own data.

-- Resolves the caller's shop from the shops.owner_user_id -> auth.uid() mapping.
-- No JWT claim required (auth.uid() is always present), matching the sync-stream
-- scoping. SECURITY DEFINER so it can read shops regardless of the caller's
-- grants/RLS; search_path pinned to public to keep it injection-safe.
create or replace function public.auth_shop_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.shops where owner_user_id = auth.uid() limit 1
$$;

-- NOTE: these policies bind anon/authenticated. The table owner and any
-- BYPASSRLS role (e.g. the SQL Editor running as `postgres`) are NOT subject to
-- them — verify isolation with `set local role authenticated` + a `request.jwt.claims`
-- GUC, not a bare query as the owner.
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
  claim text;  -- claim expression, cast to match the column's type
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

      -- audit_log.shop_id is TEXT (migration 002); every other table uses UUID.
      -- Cast the (uuid) claim to text only for audit_log so the `=` operator
      -- exists; the bare `shop_id` column on the left keeps each table's
      -- shop_id index usable.
      --
      -- Wrap the call in a scalar subquery — `(select public.auth_shop_id())` —
      -- so Postgres evaluates the STABLE function ONCE per statement (an InitPlan)
      -- instead of re-running the shops lookup for every scanned row. This is the
      -- documented Supabase RLS performance pattern and matters as tables grow.
      claim := case when t = 'audit_log'
                    then '(select public.auth_shop_id())::text'
                    else '(select public.auth_shop_id())' end;

      execute format(
        'create policy %I on public.%I for select to anon, authenticated using (shop_id = %s)',
        t || '_select_all', t, claim);
      execute format(
        'create policy %I on public.%I for insert to anon, authenticated with check (shop_id = %s)',
        t || '_insert_all', t, claim);

      -- audit_log is append-only (migration 018): never (re)create UPDATE/DELETE
      -- policies for it. Every other table keeps the full scoped CRUD set. This
      -- keeps 015 safe to re-run after 018 without reopening the audit hole.
      if t <> 'audit_log' then
        execute format(
          'create policy %I on public.%I for update to anon, authenticated using (shop_id = %s) with check (shop_id = %s)',
          t || '_update_all', t, claim, claim);
        execute format(
          'create policy %I on public.%I for delete to anon, authenticated using (shop_id = %s)',
          t || '_delete_all', t, claim);
      end if;
    end if;
  end loop;
end $$;
