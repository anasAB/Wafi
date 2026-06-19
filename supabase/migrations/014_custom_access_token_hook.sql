-- Wafi POS — Custom Access Token Hook: inject shop_id claim from shops.owner_user_id.
-- Enable it afterward in: Supabase Dashboard → Authentication → Hooks →
-- "Custom Access Token" → select public.custom_access_token_hook.
-- Idempotent (CREATE OR REPLACE / GRANT / REVOKE).

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims jsonb;
  v_shop_id uuid;
begin
  select id into v_shop_id
  from public.shops
  where owner_user_id = (event->>'user_id')::uuid
  limit 1;

  claims := event->'claims';
  if v_shop_id is not null then
    claims := jsonb_set(claims, '{shop_id}', to_jsonb(v_shop_id::text));
  else
    claims := claims - 'shop_id';
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

-- The hook runs as the supabase_auth_admin role.
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
grant select on table public.shops to supabase_auth_admin;

-- Never callable by client roles.
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;
