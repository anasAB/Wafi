# WAFI-155 — Feature Flag Framework (Engineering Rollout Flags) — Design Spec

Date: 2026-08-13
Status: Approved, ready for implementation planning

## Problem

CLAUDE.md's Week-1 architecture decisions require "feature flag infrastructure ...
every gated feature flagged at customer level ... choose one before v1 ships."
WAFI-131 already shipped per-shop entitlement flags (`staff_pack`, `customer_pack`,
`reporting_pack`, `electronics_pro`) answering "does this shop's subscription
include this feature?" — read from `shops.features` (jsonb), resolved via
`src/features/flags/flagRegistry.ts` + `flags.store.ts`.

WAFI-155 needs a second, semantically distinct concept: **engineering rollout
flags** (`dashboard_v2`, `pos_brain`, `insights` in the roadmap's examples)
that answer "should this implementation currently run for this shop?" —
independent of what the shop is paying for. These exist to de-risk future
refactors (e.g. business-services extraction) via gradual rollout and fast
incident rollback, per the plan's risk table: "Business services extraction
breaks existing flows | Medium | High | ... feature flags (WAFI-155)."

No existing mechanism in the codebase serves this. `flagRegistry.ts`'s
`FLAG_KEYS` is exclusively the 4 pricing packs, and its `resolveFlag`
semantics (`features === null` → all packs on, for grandfathered
pre-WAFI-131 shop rows) are specifically wrong for rollout flags, which have
no legacy row to grandfather and must default closed for safety.

## Scope

In scope: a new `rollout` namespace inside the existing `shops.features`
jsonb column, a fail-closed TypeScript resolver distinct from WAFI-131's,
two new `SECURITY DEFINER` RPCs gated by a new cross-shop `platform_admins`
table, and a small internal-only admin screen to toggle flags per shop.

Out of scope (deliberately, per YAGNI): percentage/gradual rollout,
scheduling, per-device or per-staff targeting, rollout audit history,
pagination beyond a 100-row cap, and a dedicated low-privilege
`SECURITY DEFINER` owner role (the codebase has no precedent for one on any
existing `SECURITY DEFINER` function; introducing it only here would be
inconsistent without a demonstrated need).

## Architecture overview

```
                    platform_admins
                          |
                     auth.uid()
                          |
                          v
                 SECURITY DEFINER RPCs
                 /                    \
      list_shops_for_rollout_admin   set_rollout_flag
                 \                    /
                          v
                   shops.features (jsonb)
                          |
                       PowerSync
                          |
                          v
                     Shop devices

Client:
  ROLLOUT_FLAG_KEYS -> RolloutFlagKey -> resolveRollout() -> isRolloutEnabled()
  -> feature implementation
```

The existing shop-scoped RLS model on `shops`/`staff` is untouched. Platform
admin is a new, orthogonal identity concept: tied to `auth.uid()` directly,
not to any `staff` row in any shop (a platform admin need not have a `staff`
row anywhere).

## 1. Data model

New migration, next available number (089 at time of writing — confirm
against `supabase/migrations/` before implementation, since numbers have
collided before in this repo, e.g. the historical dual-038 bug):

```sql
CREATE TABLE public.platform_admins (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.platform_admins IS
  'Platform-level operators, orthogonal to any shop''s staff/role model.
   Membership is managed only through the trusted Supabase dashboard SQL
   path; there is no authenticated/anon client write policy for this table.';

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

-- Self-select only: lets a signed-in client cheaply ask "am I an admin?"
-- to decide UI visibility. This is a UX check only -- real authorization
-- lives in the SECURITY DEFINER RPCs below, which independently verify
-- platform_admins membership regardless of what the client believes.
CREATE POLICY platform_admins_self_select ON public.platform_admins
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- No INSERT/UPDATE/DELETE policy for authenticated or anon at all.
```

`shops.features` (jsonb, from migration 041) gets no schema change. A new
`rollout` sub-object is introduced by convention, written only via
`set_rollout_flag`:

```json
{
  "staff_pack": true,
  "customer_pack": true,
  "reporting_pack": true,
  "electronics_pro": false,
  "rollout": {
    "dashboard_v2": true,
    "pos_brain": false,
    "insights": true
  }
}
```

No backfill needed: `set_rollout_flag` uses
`jsonb_set(coalesce(features, '{}'::jsonb), '{rollout,<key>}', ...)`, which
safely creates the `rollout` object (and the whole `features` object, if it
was `NULL`) on first write. A `features = NULL` row (WAFI-131's grandfathered
legacy case) after a rollout write becomes `{"rollout": {"dashboard_v2": true}}`
— no pack keys are introduced, and WAFI-131's `null` → all-packs-on semantic
is completely unaffected because `resolveFlag` (packs) and `resolveRollout`
(rollout) are separate functions reading the same JSON from different angles.

**Invariant (governs all future work on this column, not just WAFI-155):**
All mutations to individual `shops.features` subkeys must use atomic JSONB
path updates (`jsonb_set` on a specific path); no rollout or pack operation
may read-modify-write the entire `features` object. This is what makes a
concurrent pack-flag change and a rollout-flag change on the same shop
row safe from clobbering each other.

## 2. RPCs

Both follow this codebase's established `SECURITY DEFINER` convention
exactly (see migrations 067, 069, 072, 083-087): plain `SECURITY DEFINER`,
explicit `SET search_path = public, pg_temp` (closing the classic
search-path-hijack hole — this codebase has been bitten by a related
`SECURITY DEFINER` regression once already, migration 071), explicit
`REVOKE ... FROM public, anon` followed by `GRANT EXECUTE ... TO
authenticated` (this codebase has also been bitten by "REVOKE ALL FROM
public doesn't touch a pre-existing GRANT TO anon", migration 069's
follow-up fix — the explicit `anon` revoke is deliberate here, not
redundant). No custom low-privilege function-owner role is introduced;
none of this codebase's existing `SECURITY DEFINER` functions use one, and
adding it only for these two would be an inconsistent, unmotivated
precedent.

Error codes follow this codebase's existing convention (migrations 076,
083, 084, 086): `P0001` = authorization failure, `P0002`/`P0003` =
incrementing application-defined validation failures.

The first *application-level* operation in each function body is the
platform-admin authorization check — before any user-controlled parameter
is validated, any shop data is queried, or any mutation occurs. This
prevents an unauthorized caller from using either RPC as an oracle for
"does this flag/shop exist?"

### `set_rollout_flag`

```sql
CREATE OR REPLACE FUNCTION public.set_rollout_flag(
  p_shop_id  uuid,
  p_flag_key text,
  p_enabled  boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform_admins WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = 'P0001';
  END IF;

  IF p_flag_key NOT IN ('dashboard_v2', 'pos_brain', 'insights') THEN
    RAISE EXCEPTION 'unknown rollout flag: %', p_flag_key USING ERRCODE = 'P0003';
  END IF;

  UPDATE shops
     SET features = jsonb_set(
           coalesce(features, '{}'::jsonb),
           ARRAY['rollout', p_flag_key],
           to_jsonb(p_enabled),
           true)
   WHERE id = p_shop_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'shop not found: %', p_shop_id USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_rollout_flag(uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_rollout_flag(uuid, text, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_rollout_flag(uuid, text, boolean) TO authenticated;
```

The flag allowlist (`'dashboard_v2', 'pos_brain', 'insights'`) is a literal
SQL `IN (...)`, deliberately not derived from client input — a second,
independent enforcement point alongside the TypeScript `ROLLOUT_FLAG_KEYS`
registry. **Paired-edit convention:** adding a new rollout flag requires
editing this SQL literal in the same commit/migration that adds the key to
`ROLLOUT_FLAG_KEYS` in TypeScript. There is no mechanism to share the
literal between SQL and TS; this is a documented manual invariant, not
enforced by tooling.

### `list_shops_for_rollout_admin`

```sql
CREATE OR REPLACE FUNCTION public.list_shops_for_rollout_admin(p_query text DEFAULT NULL)
RETURNS TABLE (
  shop_id      uuid,
  shop_name    text,
  dashboard_v2 boolean,
  pos_brain    boolean,
  insights     boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM platform_admins WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT s.id, s.name,
         coalesce((s.features -> 'rollout' ->> 'dashboard_v2')::boolean, false),
         coalesce((s.features -> 'rollout' ->> 'pos_brain')::boolean, false),
         coalesce((s.features -> 'rollout' ->> 'insights')::boolean, false)
    FROM shops s
   WHERE NULLIF(trim(p_query), '') IS NULL
      OR s.name ILIKE '%' || trim(p_query) || '%'
   ORDER BY s.name
   LIMIT 100;
END;
$$;

REVOKE ALL ON FUNCTION public.list_shops_for_rollout_admin(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_shops_for_rollout_admin(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_shops_for_rollout_admin(text) TO authenticated;
```

Returns only the fields the admin UI needs — never the raw `features` blob,
which also carries pack entitlements the rollout screen has no reason to
see or leak. `NULLIF(trim(p_query), '')` normalizes `NULL`, `''`, and
whitespace-only input to "no filter." `ILIKE` on a `LIMIT 100` result needs
no index at this shop count; documented here as a future optimization
trigger, not a v1 concern: *if the shop population grows enough that the
`%query%` scan becomes material, replace with an indexed search strategy.*

Server-side search (not "return all shops, filter client-side") is a
deliberate choice: this RPC is already a platform-scoped privileged
boundary, and keeping its returned dataset narrow is the cleaner invariant
to hold as shop count, admin count, and per-shop metadata all grow over
time — even though today's scale doesn't strictly require it.

## 3. Client-side registry & resolver

`flagRegistry.ts` additions:

```ts
export const ROLLOUT_FLAG_KEYS = ['dashboard_v2', 'pos_brain', 'insights'] as const
export type RolloutFlagKey = typeof ROLLOUT_FLAG_KEYS[number]

/** Fail-closed: missing/absent/malformed rollout config -> false. Does NOT
 *  mirror WAFI-131's null-blob "grandfathered -> all on" pack semantics --
 *  there is no legacy row to grandfather for a flag that didn't exist
 *  until now. Only the literal boolean `true` ever enables a rollout. */
export function resolveRollout(
  features: Record<string, unknown> | null,
  key: RolloutFlagKey,
): boolean {
  const rollout = features?.rollout
  if (typeof rollout !== 'object' || rollout === null) return false
  return (rollout as Record<string, unknown>)[key] === true
}
```

`resolvePack` (the existing `resolveFlag`, renamed only in this doc for
clarity — no rename required in code) and `resolveRollout` are kept as two
separate functions, never merged into one generic `resolveFlag(features,
key)` taking a union key type. Combining them is exactly how WAFI-131's
`null` → all-on grandfathering could accidentally leak into rollout-flag
semantics later. `FlagKey` and `RolloutFlagKey` are disjoint TypeScript
types, so `isRolloutEnabled('reporting_pack')` and `isEnabled('dashboard_v2')`
are both compile errors — no additional runtime guard is needed beyond
this type separation.

`flags.store.ts` gains `isRolloutEnabled(key: RolloutFlagKey): boolean`
alongside the existing `isEnabled(key: FlagKey): boolean`, both reading the
same already-loaded `features` ref — no second DB query, no second sync
path.

**Resolution model — dynamic-at-read:** consumers call
`flags.isRolloutEnabled(key)` at the point of use (matching today's
`isEnabled` call sites in `AppSidebar.vue`/`router/index.ts`), not once at
boot into a frozen value. This makes offline/reconnect behavior fall out
for free: `features` only changes when `load()`/PowerSync re-syncs the
`shops` row, so a device offline during a flag flip keeps the old (cached)
value and picks up the new one on its next sync — no additional
synchronization machinery needed.

**Consumer invariant:** the resolver itself is dynamic and always reads the
current synced `features` value; consumers must not cache a rollout
decision into local component state beyond the lifecycle/state boundary the
feature actually needs. Storing `const dashboardV2 =
flags.isRolloutEnabled('dashboard_v2')` in `setup()` and reusing it for the
component's full lifetime silently defeats the fast-rollback purpose this
whole ticket exists for.

Locked invariants for Section 3/4, restated as a checklist:
- Separate `FlagKey` and `RolloutFlagKey` types.
- Separate `isEnabled()` and `isRolloutEnabled()` methods.
- Only explicit boolean `true` enables a rollout; missing/null/malformed → `false`.
- No second persistence/sync path — reuses WAFI-131's already-loaded `features`.
- Dynamic-at-read resolution; no cached/frozen boot-time snapshot.
- No generic resolver merging pack and rollout semantics.

## 4. Admin authorization caching (client)

A new, dedicated Pinia store, `usePlatformAdminStore` — not folded into
`session.store.ts`, which is scoped to the per-shop staff/operator identity
(PIN-switching, `StaffPermissions`), a different axis entirely. Platform
admin is tied to `auth.uid()` directly; a platform admin need not have a
`staff` row in any shop.

- `checked: boolean`, `isAdmin: boolean` refs.
- `ensureChecked()`: if not yet `checked`, runs `SELECT 1 FROM
  platform_admins WHERE user_id = auth.uid()` (the self-select policy from
  Section 1) once, caches the result.
- Reset (`checked = false`, `isAdmin = false`) on the existing Supabase
  auth-state-change sign-out listener.
- Not persisted — cheap enough to re-check once per app load; avoids
  persisting a security-relevant flag to local storage.

Router guard, sidebar nav item, and the admin screen itself all call
`ensureChecked()` and read `isAdmin` — one query per session, not one per
consumer.

**This is a UX/visibility check only.** Real authorization is enforced
independently, every call, inside `set_rollout_flag` and
`list_shops_for_rollout_admin`. A manipulated client that forces the admin
route to render gains nothing — both RPCs reject a non-admin caller
regardless of what the UI believes.

## 5. Admin UI

New route `/admin/rollouts`, component `RolloutAdminScreen.vue` under
`src/features/admin/` (a distinct surface from `src/features/flags/`, which
owns flag *consumption*, not administration).

**Access control (two independent layers, matching the "UI check is never
authorization" principle):**
- Router guard on `/admin/rollouts`: `usePlatformAdminStore().ensureChecked()`
  then `isAdmin`; on `false`, redirect away as if the route doesn't exist
  (not a "you're not allowed" page — don't advertise the route to
  non-admins).
- `AppSidebar.vue`: "Feature Rollouts" nav item renders only when
  `isAdmin` is true — same pattern as existing `FlagKey`-gated nav items.

**Layout:** a single searchable table, one row per shop, one column per
`ROLLOUT_FLAG_KEYS` entry (columns are generated from the registry, so
adding a 4th flag adds a 4th column automatically — no UI code change
needed), each cell a toggle:

```
Engineering rollout controls
These flags control unreleased or staged implementations. Changes are
shop-wide and affect all devices belonging to the shop, applied after the
shop's next device sync.

[ Search shop...                                        ]

Shop                    dashboard_v2   pos_brain   insights
──────────────────────────────────────────────────────────
Al Noor Pharmacy          ● ON          ○ OFF       ● ON
Damascus Electronics      ○ OFF         ○ OFF       ○ OFF
```

- Loads via `list_shops_for_rollout_admin(query)`; debounced search input
  re-queries server-side (per Section 2's server-side-search decision).
- **Toggle interaction:** single-click, symmetric for ON and OFF, no
  confirmation modal either direction. Rationale: this screen is also the
  incident-rollback kill switch, and confirmation friction directly
  conflicts with that purpose. The existing safeguards (internal-only
  route, platform-admin-gated RPCs, one-shop-one-flag-per-interaction, no
  bulk action, atomic server-side update) are judged sufficient without an
  added confirm step.
- **Optimistic update with per-cell pending lock:** click flips the toggle
  immediately and disables *only that cell* (not the whole table) while its
  `set_rollout_flag` call is in flight; success leaves it changed with a
  brief inline success message ("Dashboard V2 enabled for Al Noor
  Pharmacy" / "...disabled for..."); failure reverts the cell and shows an
  inline error ("Couldn't update Dashboard V2 for Al Noor Pharmacy.
  Please try again."). Disabling the individual cell (not a table-wide
  lock) prevents a double-click from firing two overlapping mutations for
  the same shop/flag pair, while leaving the rest of the table usable.
- **Search/mutation interaction invariant:** a mutation is scoped to its
  shop/flag cell and remains authoritative until its RPC resolves; a
  search-triggered table refresh must not spawn a second mutation for the
  same cell, nor allow a refreshed server read to silently overwrite a
  still-pending optimistic state. The per-cell pending lock from the
  previous point is what enforces this in practice — a cell mid-mutation
  is excluded from being clobbered by a concurrent refresh's rendered
  value.
- No bulk/global toggle. Each interaction targets exactly one shop × one
  flag — a deliberate guard against an accidental platform-wide change.

## 6. Testing

### pgTAP (`supabase/tests/wafi155_rollout_flags.test.sql`)

1. Non-admin authenticated caller (has `EXECUTE` grant, is not in
   `platform_admins`) → `set_rollout_flag` raises `P0001`;
   `list_shops_for_rollout_admin` raises `P0001`. This is the critical
   authorization-boundary test — proving the grant alone doesn't confer
   access, only `platform_admins` membership does.
2. `anon`/`PUBLIC` have no `EXECUTE` grant on either function at all
   (`information_schema.routine_privileges` assertion, matching WAFI-069's
   grant-narrowing test pattern) — a distinct, complementary check from #1.
3. Platform admin, `features = NULL` on the target shop row →
   `set_rollout_flag` succeeds; resulting `features` is exactly
   `{"rollout": {"dashboard_v2": true}}`, with no pack keys introduced and
   no backfill required. Locks down the deliberate divergence from
   WAFI-131's `null`-blob pack semantics.
4. Platform admin, existing shop with pack keys already set → setting one
   rollout key leaves all pack keys and any previously-set rollout keys
   unchanged (a direct assertion on the full `features` value, not just
   the target key).
5. **Sequential path-preservation test** (explicitly not a concurrency
   test): calling `set_rollout_flag` for `dashboard_v2` then `pos_brain` on
   the same shop leaves both keys correctly set — proves one rollout
   mutation doesn't destroy a different previously-written rollout key or
   an unrelated pack key. Real concurrent writes from two simultaneous
   sessions are explicitly out of scope for this suite (no
   Docker/concurrent-Postgres harness in this sandbox — the same recurring
   limitation already documented for WAFI-150/143/151).
6. Unknown flag key → `P0003`.
7. Nonexistent shop id → `P0002`.
8. `list_shops_for_rollout_admin(NULL)`, `('')`, and `('   ')` all return
   the identical unfiltered result set.

### Vitest (client)

1. `resolveRollout`: table test over `undefined`, `null`, `false`, `0`,
   `'true'`, `{}`, `[]`, `{dashboard_v2: true}` as the `rollout` value —
   only the last resolves to `true`.
2. `useFlagsStore.isRolloutEnabled` reads the same loaded `features` ref as
   `isEnabled` — no second `db.getOptional` call (spy/count assertion).
3. `RolloutAdminScreen`: toggle click → optimistic flip → RPC resolves →
   stays changed; RPC rejects → reverts + inline error shown; a second
   click while the first is pending is a no-op (cell is disabled), not a
   second in-flight request.
4. Router guard: non-platform-admin navigating to `/admin/rollouts`
   redirects away; platform-admin passes through.

### Explicitly out of scope (documented, not silently skipped)

- Real concurrent writes from two simultaneous sessions against the same
  shop row (no Docker/concurrent-Postgres harness available in this
  project's sandbox).
- Actual PowerSync sync-rule propagation of a `shops.features` change to a
  real offline device (requires two live device sessions; manual
  verification, same as this codebase's other recent tickets).

## Open items for the implementation plan

- Confirm the actual next-available migration number against
  `supabase/migrations/` at implementation time (this repo has a history
  of migration-number collisions, e.g. the historical dual-038 bug fixed
  during the local-Supabase-stack repair effort).
- Bootstrapping the first `platform_admins` row(s) (the founders) is a
  manual, one-time `INSERT` run directly via the Supabase dashboard SQL
  editor after migration deploy — not part of the migration itself (no
  client write path exists by design, and hardcoding founder UUIDs into
  the migration would need a rewrite the moment admin membership changes).
