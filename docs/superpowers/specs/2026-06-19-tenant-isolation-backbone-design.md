# Sub-project 1 — Tenant Isolation Backbone (Design)

> ⚠️ **SUPERSEDED — the JWT-claim / access-token-hook design below was NOT shipped.**
> The implementation scopes on the `shops.owner_user_id → auth.uid()` mapping
> everywhere (RLS via `auth_shop_id()`, sync rules via `owner_user_id`, and the
> client reads `shopId` from the synced `shops` row). There is no `shop_id` claim,
> no `custom_access_token_hook`, and migration `014` was removed. Read this only
> for historical context. See `powersync.yaml` and migration `015` for the truth.

> Date: 2026-06-19
> Status: SUPERSEDED (replaced by the no-claim owner_user_id mapping)
> Part of the "real auth" epic. Build order: **1 (this) → 2 (signup + provisioning) → 3 (device registration)**.

## Problem

RLS on all synced tables is currently wide-open (`USING (true)` / `WITH CHECK (true)`), so any
authenticated user can read or write any shop's rows. The client `shop_id` is a hardcoded stub
(`VITE_STUB_SHOP_ID`, default `…0001`) and no user→shop mapping exists. The PowerSync sync rules
(`powersync.yaml`) already *assume* a `request.jwt() ->> 'shop_id'` claim that nothing currently
produces.

This sub-project establishes the identity backbone both RLS and the sync rules depend on, without
building the signup or device-registration flows (Sub-projects 2 and 3).

## Decisions (locked during brainstorming)

1. **One Supabase Auth account per shop.** The account is the shop's cloud/sync login. The existing
   `staff` (owner/cashier, PIN-based) layer remains the per-operator/accountability system. No
   `shop_members` table, no invite flow — `staff` already covers multi-operator.
2. **Claim delivery = Custom Access Token Hook (Approach B).** A Postgres hook injects a top-level
   `shop_id` claim at every token mint, derived from `shops.owner_user_id`. Chosen over
   `app_metadata` because it matches the existing sync rules unchanged, is always fresh, needs no
   extra infra/cost, and keeps a single source of truth.
3. **Client reads `shop_id` by decoding the local JWT** (no network round-trip) to preserve
   offline-first.
4. Scope is isolation only — no signup UI, no real device registration in this sub-project.

## Source of truth

`shops.owner_user_id uuid` — new column referencing `auth.users(id)`, unique (one shop per owner
account). Sub-project 2 will populate it at signup. For testing now, set the seed shop (`…0001`)
`owner_user_id` to the dev user's auth uid so existing local data and the claim align with **zero
data migration**.

## Data flow

```
token mint ──▶ custom_access_token_hook(event)
                  └─ select id from shops where owner_user_id = (event->>'user_id')::uuid
                  └─ inject top-level claim: shop_id  (or remove it if no shop)

JWT { ..., shop_id: "…0001" }
   ├─▶ RLS:        every tenant table → shop_id = auth_shop_id()
   ├─▶ sync rules: request.jwt() ->> 'shop_id'   (UNCHANGED)
   └─▶ client:     decode local JWT → deviceStore.shopId
```

All 19 synced tables carry a `shop_id` column (denormalized onto child tables such as
`sale_line_items`, `sale_payments`, `return_line_items`, `stock_receiving_line_items`), so one
uniform predicate applies everywhere.

## Components

### a. `shops.owner_user_id`
- Migration: `ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id)`.
- `CREATE UNIQUE INDEX IF NOT EXISTS uq_shops_owner_user ON shops(owner_user_id) WHERE owner_user_id IS NOT NULL`.
- Manual test step: `UPDATE shops SET owner_user_id = '<dev-user-uid>' WHERE id = '…0001';`

### b. `custom_access_token_hook(event jsonb) returns jsonb`
- `plpgsql`, `stable`.
- Reads the owner's shop; sets `claims.shop_id` (text uuid) or removes it when absent.
- Grants: `EXECUTE` to `supabase_auth_admin` only; `REVOKE EXECUTE FROM authenticated, anon, public`;
  `GRANT SELECT ON public.shops TO supabase_auth_admin` (the hook runs as the auth admin role).
- **Enablement is config, not migration**: Supabase → Authentication → Hooks → Custom Access Token
  → select this function. Document it; it must be enabled in each environment.

```sql
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb language plpgsql stable as $$
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
```

### c. `auth_shop_id()` helper (DRY for policies)
```sql
create or replace function public.auth_shop_id()
returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'shop_id', '')::uuid
$$;
```

### d. Scoped-RLS migration
- Loop over every tenant table (the 16 from migration 012 **plus** `products`, `staff`, `audit_log`,
  which are still `USING (true)` from 005/006/008).
- For each: drop the existing `*_select_all` / `*_insert_all` / `*_update_all` / `*_delete_all`
  policies and recreate them scoped:
  - SELECT / DELETE: `USING (shop_id = public.auth_shop_id())`
  - UPDATE: `USING (shop_id = public.auth_shop_id()) WITH CHECK (shop_id = public.auth_shop_id())`
  - INSERT: `WITH CHECK (shop_id = public.auth_shop_id())`
- Idempotent (drop-if-exists + create), mirroring the loop style of migration 010/012.

### e. Client `deviceStore`
- `shopId` becomes a `ref<string | null>` populated from the decoded JWT after auth, re-read on
  token refresh (subscribe to `supabase.auth.onAuthStateChange`).
- Small base64url-decode helper for the JWT payload — **no new dependency** (avoids an ADR;
  `JSON.parse` of the base64url-decoded middle segment).
- `deviceId` / `deviceCode` remain stubbed (owned by Sub-project 3).
- Consumers read `deviceStore.shopId` after auth has completed (the app already gates POS behind
  auth / `OwnerSetupScreen`), but must tolerate `null` before sign-in (no writes attempted).

## Rollout order (hard sequence — avoids self-lockout)

Applying scoped RLS before the claim exists denies everything and breaks sync. Strict order:

1. Apply migration: `shops.owner_user_id` (+ unique index). Set it on the seed shop.
2. Create the hook function (migration) **and enable it** in Supabase Auth hooks.
3. **GATE:** sign out/in; decode the access token; confirm `shop_id` is present and correct.
4. Only after the gate passes: apply the scoped-RLS migration (replaces the permissive policies).
5. Ship the client change that reads `shop_id` from the token.

If the gate fails, do **not** apply step 4 (you would lock the account out of its own data).

## Error handling & edge cases

- **No shop yet** (signed up, not provisioned): no claim → RLS denies all; client `shopId` is null →
  app stays on onboarding, attempts no writes. Correct.
- **Offline**: the client decodes the locally-stored token — no network needed (Sacred Rule #1).
- **Empty/malformed claim**: `nullif(...,'')::uuid` guards the empty string; the hook only ever emits
  valid uuids, so a cast error is not reachable in normal operation.
- **PowerSync upload** uses the user's `access_token` (connector `fetchCredentials`), so writes are
  enforced under the user's RLS — isolation is not bypassed by the sync path.
- **Existing local data** uses stub `shop_id = …0001`; with the seed shop's `owner_user_id` set, the
  claim equals `…0001`, so local and server align — no data migration.

## Testing

- **Cross-tenant isolation (primary):** two users / two shops; assert user A cannot SELECT or INSERT
  user B's rows (expect `42501`), and can read/write only its own.
- **Regression:** dev user (claim `…0001`) still syncs end-to-end; a sale writes all four tables.
- **Client unit:** `deviceStore` extracts `shop_id` from a sample JWT; yields `null` for a
  claim-less token.
- **Verification SQL:** policy presence per table; a decode-token check (client console) at the gate.

## Out of scope (later sub-projects)

- Self-serve signup UI, shop creation on signup, owner bootstrap wiring (Sub-project 2).
- Real per-device `device_id` registration and multi-device sale sequencing (Sub-project 3).
- Per-shop isolation for `shops`/`devices` themselves and any non-bucket tables.
- Reconciling migration/schema drift and fixing `supabase db push` linkage (tracked separately).
