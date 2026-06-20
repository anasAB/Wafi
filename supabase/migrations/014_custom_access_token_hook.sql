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
  v_user_id uuid := nullif(event->>'user_id', '')::uuid;
  v_shop_id uuid;
begin
  -- Defensive: a missing user_id must not break token minting for everyone.
  if v_user_id is not null then
    select id into v_shop_id
    from public.shops
    where owner_user_id = v_user_id
    limit 1;
  end if;

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
<<<<<<< HEAD


const { supabase } = await import('/src/data/supabase/client.ts')
const { data, error } = await supabase.auth.refreshSession()
console.log('refresh error:', error?.message ?? 'none')
const p = JSON.parse(atob(data.session.access_token.split('.')[1]))
console.log('sub:', p.sub, '| shop_id:', p.shop_id)
=======
>>>>>>> 3ff516043a2ce84079a600fe3e822f3a14a84c3d
