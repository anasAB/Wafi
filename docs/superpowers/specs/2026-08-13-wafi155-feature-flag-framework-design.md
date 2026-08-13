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
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
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

-- RLS alone is not sufficient -- PostgREST/the Supabase client also needs
-- table-level privilege to attempt the SELECT at all. Explicit grants,
-- deliberately narrow: read-your-own-row only, no client write path.
GRANT SELECT ON public.platform_admins TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.platform_admins FROM authenticated;
REVOKE ALL ON public.platform_admins FROM anon;
```

`ON DELETE CASCADE` means platform-admin membership disappears automatically
if the underlying `auth.users` row is ever deleted — no orphaned admin rows
to reason about later.

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

**Critical NULL-grandfathering interaction (verified against actual code,
not assumed — this was the one point in this spec worth stopping and
checking before implementation).** `021_provision_shop_on_signup.sql` never
sets `features` on shop creation, so **every shop created today, not just
pre-WAFI-131 legacy rows, has `features = NULL`**. `flagRegistry.ts`'s
`resolveFlag` is `if (features === null) return true` — unconditional
all-packs-on for a `NULL` blob. A naive `jsonb_set(coalesce(features,
'{}'::jsonb), ...)` would turn that `NULL` into
`{"rollout": {"dashboard_v2": true}}` with **no pack keys at all** —
and since `resolveFlag` only special-cases the literal `null` value (not an
object missing the keys), every pack would silently resolve to `false` the
instant *any* rollout flag is set on that shop. This is a live,
current-production-relevant risk, not a legacy-row edge case, because new
signups hit it immediately.

**Fix:** `set_rollout_flag` must materialize a `NULL` `features` value into
the same all-packs-on state `resolveFlag` already grants that shop live,
before applying the rollout path:

```sql
UPDATE shops
   SET features = jsonb_set(
         CASE
           WHEN features IS NULL THEN
             '{"staff_pack": true, "customer_pack": true, "reporting_pack": true, "electronics_pro": true}'::jsonb
           ELSE features
         END,
         ARRAY['rollout', p_flag_key],
         to_jsonb(p_enabled),
         true)
 WHERE id = p_shop_id;
```

Note this literal is deliberately **not** the same as migration 041's
one-time backfill value (which set `electronics_pro: false` for specific
already-known pilot shops at that specific moment in time). This
materialization must match what `resolveFlag(null, key)` grants *right
now*, for *any* shop hitting this path today — unconditional all-four-true
— not a historical snapshot decision that was correct for a different set
of shops at a different time. Using the wrong literal here would silently
downgrade a shop's entitlements the moment its first rollout flag is set,
which is exactly the class of bug this spec exists to prevent.

Required pgTAP test (see Section 6): a shop with `features IS NULL`, after
`set_rollout_flag(shop_id, 'dashboard_v2', true)`, must resolve
`staff_pack`/`customer_pack`/`reporting_pack`/`electronics_pro` as `true`
(matching pre-write `resolveFlag(null, ...)` behavior) in addition to
`rollout.dashboard_v2 = true`.

**Direct-client-write risk (checked, not currently broken, but fragile —
worth explicit regression coverage).** Migration `075` added a client
`UPDATE` policy on `shops` (for owner-editable discount-cap columns) after
`041`'s comment claimed "shops has no client UPDATE policy today." Checked
`075`'s actual trigger (`protect_shop_server_only_columns`): it still
resets `NEW.features := OLD.features` for any JWT-carrying request, so
`features` remains fully protected against direct client writes today —
this is not a live bug. However, this codebase has a demonstrated history
of exactly this failure class recurring (the `custom_access_token_hook`
`SECURITY DEFINER` property was silently dropped and had to be restored
twice — migrations 053/071, per WAFI-151's status notes), so a future
migration touching `shops`'s triggers could silently reopen this without
anyone noticing. Required pgTAP test (Section 6): an authenticated
non-admin owner directly attempting `UPDATE shops SET features = ...` must
have `features` reverted by the trigger — a regression guard, not proof of
a current bug.

**Invariant (scoped to WAFI-155's own mutations — this ticket does not
refactor or re-enforce unrelated existing pack-mutation code):** all
rollout mutations to `shops.features` subkeys must use atomic JSONB path
updates (`jsonb_set` on a specific path); no rollout operation may
read-modify-write the entire `features` object. Existing and future pack
mutations should follow the same rule for the same reason, but WAFI-155
does not audit or change any pack-mutation code path to enforce it there.
This is what makes a concurrent pack-flag change and a rollout-flag change
on the same shop row safe from clobbering each other, on the rollout side.

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
  -- Authorization first, before any parameter is validated -- an
  -- unauthorized caller must not learn whether p_shop_id/p_flag_key are
  -- even well-formed.
  IF NOT EXISTS (SELECT 1 FROM platform_admins WHERE user_id = auth.uid()) THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = 'P0001';
  END IF;

  -- Explicit NULL checks: SQL's three-valued logic means `NULL NOT IN (...)`
  -- evaluates to NULL (falsy), not TRUE, so a NULL flag key would otherwise
  -- silently skip the allowlist check below.
  IF p_shop_id IS NULL THEN
    RAISE EXCEPTION 'shop id is required' USING ERRCODE = 'P0002';
  END IF;
  IF p_flag_key IS NULL OR p_enabled IS NULL THEN
    RAISE EXCEPTION 'flag key and enabled value are required' USING ERRCODE = 'P0003';
  END IF;

  IF p_flag_key NOT IN ('dashboard_v2', 'pos_brain', 'insights') THEN
    RAISE EXCEPTION 'unknown rollout flag: %', p_flag_key USING ERRCODE = 'P0003';
  END IF;

  -- A NULL features blob means resolveFlag() (flagRegistry.ts) currently
  -- grants this shop every pack (its grandfathered/new-shop default -- see
  -- the "Critical NULL-grandfathering interaction" note above). Writing a
  -- rollout key into a bare '{}' would silently drop every pack to "off"
  -- the instant this function first touches that shop. Materialize the
  -- same all-on state resolveFlag(null, ...) already grants, before
  -- applying the rollout path -- not migration 041's one-time backfill
  -- literal, which used different values for a different, already-known
  -- set of shops at a different point in time.
  UPDATE shops
     SET features = jsonb_set(
           CASE
             WHEN features IS NULL THEN
               '{"staff_pack": true, "customer_pack": true, "reporting_pack": true, "electronics_pro": true}'::jsonb
             ELSE features
           END,
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
registry. **Paired-edit convention (updated):** adding a new rollout flag
requires updating, in the same change: `ROLLOUT_FLAG_KEYS` in TypeScript,
this function's SQL allowlist, `list_shops_for_rollout_admin`'s return
shape and `SELECT` list (below), and the corresponding generated Supabase
TypeScript types. There is no mechanism to share a single source of truth
across SQL and TS for this; the paired edit is a documented manual
invariant, not enforced by tooling — deliberately, since a fifth
cross-cutting table/config layer for three-to-ten engineering flags would
be over-engineering for this ticket's scope.

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

  -- Fail-closed flag parsing, matching the TypeScript resolver's contract:
  -- only the JSON literal `true` reads as enabled. `= 'true'::jsonb` on a
  -- non-boolean value (a stray string "true", a number, a malformed
  -- object) evaluates to NULL rather than throwing, so coalesce(..., false)
  -- safely reduces every malformed case to "off" instead of raising past
  -- this function's caller (the admin screen) with an error.
  RETURN QUERY
  SELECT s.id, s.name,
         coalesce(s.features -> 'rollout' -> 'dashboard_v2' = 'true'::jsonb, false),
         coalesce(s.features -> 'rollout' -> 'pos_brain'    = 'true'::jsonb, false),
         coalesce(s.features -> 'rollout' -> 'insights'     = 'true'::jsonb, false)
    FROM shops s
   WHERE NULLIF(trim(p_query), '') IS NULL
      OR s.name ILIKE '%' || trim(p_query) || '%'
   ORDER BY s.name, s.id
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
whitespace-only input to "no filter." `ORDER BY s.name, s.id` gives
deterministic ordering when two shops share a name (plain `ORDER BY
s.name` ties are otherwise implementation-defined and could shuffle
between calls). `ILIKE` on a `LIMIT 100` result needs no index at this shop
count; documented here as a future optimization trigger, not a v1 concern:
*if the shop population grows enough that the `%query%` scan becomes
material, replace with an indexed search strategy.* The UI surfaces the
100-row cap explicitly (Section 5) so an admin doesn't mistake a
101st-match shop for one that doesn't exist.

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

Locked invariants for the client registry/resolver, restated as a checklist:
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

A naive `checked: boolean` / `isAdmin: boolean` pair has three real gaps:
it doesn't distinguish *which* user was checked (a sign-out/sign-in as a
different user would keep serving the previous user's cached `isAdmin`), it
would permanently cache a transient network failure as "checked, not
admin" with no retry path, and three near-simultaneous callers (router
guard, sidebar, screen, all mounting around the same time) would fire three
identical queries instead of sharing one in-flight request. State:

```ts
const checkedForUserId = ref<string | null>(null)
const isAdmin          = ref(false)
let   pendingPromise: Promise<boolean> | null = null
```

`ensureChecked()`:
1. Read the current authenticated user id.
2. If `checkedForUserId === currentUserId`, return the cached `isAdmin`
   immediately — no query.
3. If a `pendingPromise` is already in flight (for the same user), await
   and return it rather than firing a second query.
4. Otherwise, query `SELECT 1 FROM platform_admins WHERE user_id =
   auth.uid()` (the self-select policy from Section 1), store the promise
   in `pendingPromise` while it's outstanding.
5. On success: set `checkedForUserId = currentUserId`, `isAdmin = <result>`,
   clear `pendingPromise`.
6. On network/query error: clear `pendingPromise` **without** setting
   `checkedForUserId` — the check remains retryable on the next call rather
   than being permanently and incorrectly cached as "not admin."

Reset (`checkedForUserId = null`, `isAdmin = false`) on the existing
Supabase auth-state-change sign-out listener, and implicitly invalidated on
any user-id change since step 2 keys the cache to the specific user id, not
just a boolean "have I ever checked." Not persisted — cheap enough to
re-check once per session; avoids persisting a security-relevant flag to
local storage.

Router guard, sidebar nav item, and the admin screen itself all call
`ensureChecked()` and read `isAdmin` — at most one query per user per
session, with concurrent callers sharing the same in-flight request.

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
- **Stale-response guard:** each search request carries a monotonically
  increasing sequence number (`const requestId = ++latestRequestId`); when
  a response arrives, it's only applied to the visible table if its
  `requestId` still matches `latestRequestId`. Without this, a fast second
  keystroke's response arriving before the first keystroke's response would
  otherwise let the *first* (now-stale) response overwrite the table last.
- **Toggle interaction:** single-click, symmetric for ON and OFF, no
  confirmation modal either direction. Rationale: this screen is also the
  incident-rollback kill switch, and confirmation friction directly
  conflicts with that purpose. The existing safeguards (internal-only
  route, platform-admin-gated RPCs, one-shop-one-flag-per-interaction, no
  bulk action, atomic server-side update) are judged sufficient without an
  added confirm step.
- **Optimistic update with explicit pending-mutation state:** the component
  holds pending mutations keyed by `(shopId, flagKey)` — e.g. a
  `pending: Record<string, boolean>` map — separately from the table data
  loaded from the last `list_shops_for_rollout_admin` response. On click:
  record the optimistic value in `pending`, disable *only that cell*, and
  fire `set_rollout_flag`. Render logic per cell is "pending value if
  present, else server value" — so a table-wide `list_shops_for_rollout_admin`
  refresh (e.g. from a search re-query) can safely re-render every other
  cell from fresh server data without touching a cell still in `pending`,
  and cannot clobber a still-in-flight optimistic value. On RPC success,
  clear that entry from `pending` (the next server read already reflects
  the change) and show a brief inline success message ("Dashboard V2
  enabled for Al Noor Pharmacy" / "...disabled for..."); on failure, clear
  the `pending` entry, revert the cell to its last known server value, and
  show an inline error ("Couldn't update Dashboard V2 for Al Noor
  Pharmacy. Please try again."). A cell already present in `pending` is
  disabled, so a double-click cannot fire a second overlapping mutation for
  the same shop/flag pair.
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
3. **`features = NULL` grandfathering test (the blocking finding from
   design review):** platform admin calls `set_rollout_flag(shop_id,
   'dashboard_v2', true)` against a shop with `features IS NULL`. Assert
   the resulting `features` has `rollout.dashboard_v2 = true` **and**
   `staff_pack = customer_pack = reporting_pack = electronics_pro = true`
   — i.e., resolving the same shop's pack flags through `resolveFlag`
   semantics gives the identical result before and after the write. This
   is the regression test for the NULL-materialization fix in Section 1/2.
4. Platform admin, existing shop with pack keys already set (non-NULL
   `features`) → setting one rollout key leaves all pack keys and any
   previously-set rollout keys unchanged (a direct assertion on the full
   `features` value, not just the target key).
5. **Sequential path-preservation test** (explicitly not a concurrency
   test — renamed from an earlier draft that overstated what it proves):
   calling `set_rollout_flag` for `dashboard_v2` then `pos_brain` on the
   same shop leaves both keys correctly set — proves one rollout mutation
   doesn't destroy a different previously-written rollout key or an
   unrelated pack key. Real concurrent writes from two simultaneous
   sessions are explicitly out of scope for this suite (no
   Docker/concurrent-Postgres harness in this sandbox — the same recurring
   limitation already documented for WAFI-150/143/151).
6. Unknown flag key → `P0003`.
7. Nonexistent shop id → `P0002`.
8. `NULL p_shop_id`, `NULL p_flag_key`, `NULL p_enabled` (called by a
   platform admin, so these test the parameter-validation branch
   specifically, not the authorization branch) → `P0002`/`P0003` as
   appropriate, not a silent no-op from SQL's three-valued-logic `NOT IN`
   trap.
9. `list_shops_for_rollout_admin(NULL)`, `('')`, and `('   ')` all return
   the identical unfiltered result set.
10. A shop with a malformed rollout value (e.g.
    `{"rollout": {"dashboard_v2": "true"}}`, a JSON string not a boolean) →
    `list_shops_for_rollout_admin` returns `dashboard_v2 = false` for that
    row, not an error — the fail-closed `= 'true'::jsonb` comparison
    working as intended.
11. `platform_admins` grants/RLS directly: authenticated user can `SELECT`
    only their own row (a non-admin's `SELECT` returns zero rows even
    though the query itself succeeds); `INSERT`/`UPDATE`/`DELETE` from
    `authenticated` are all denied; all operations from `anon` are denied.
12. **Direct-write regression guard:** an authenticated non-admin owner
    directly executing `UPDATE shops SET features = ... WHERE id =
    <their own shop>` has `features` reverted to its prior value by
    `protect_shop_server_only_columns` (migration 075) — proves the
    existing trigger still protects `features` against the client
    `shops_update_owner` policy, guarding against the kind of trigger
    regression this codebase has hit twice before (migrations 053/071).

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
5. `usePlatformAdminStore`: user switching (admin user A signs out, non-admin
   user B signs in → `isAdmin` becomes `false`, not stale `true` from A);
   a failed/errored check leaves the store retryable on the next
   `ensureChecked()` call rather than permanently caching `isAdmin = false`;
   three concurrent `ensureChecked()` calls for the same user resolve to
   exactly one underlying query (spy/count assertion on the Supabase call).
6. Stale search response: fire request A (query "A"), then request B
   (query "Al") before A resolves; resolve B first, then A — assert the
   table still reflects B's results, not A's, after both settle.
7. Pending-mutation-survives-refresh: start a toggle mutation (cell enters
   `pending`), trigger a table refresh (new `list_shops_for_rollout_admin`
   response arrives) before the mutation's RPC resolves — assert the
   pending cell keeps showing its optimistic value through the refresh,
   then reflects the correct final state once the RPC resolves.

### Explicitly out of scope (documented, not silently skipped)

- Real concurrent writes from two simultaneous sessions against the same
  shop row (no Docker/concurrent-Postgres harness available in this
  project's sandbox).
- Actual PowerSync sync-rule propagation of a `shops.features` change to a
  real offline device (requires two live device sessions; manual
  verification, same as this codebase's other recent tickets).

## 7. Operational runbook: platform-admin lifecycle

There is deliberately no UI to manage `platform_admins` membership (Section
1) — this is a manual, dashboard-only operation:

```sql
-- Add an admin (run once you have their auth.users id, e.g. from the
-- Supabase Auth dashboard or a SELECT against auth.users by email):
INSERT INTO platform_admins (user_id) VALUES ('<uuid>');

-- Remove an admin (e.g. a hired rollout manager's contract ends):
DELETE FROM platform_admins WHERE user_id = '<uuid>';
```

- **Onboarding a new admin** (e.g. a future hire managing rollouts):
  resolve their `auth.users.id` and run the `INSERT` above.
- **Offboarding:** run the `DELETE` above. If their `auth.users` row is
  also deleted, `ON DELETE CASCADE` removes the `platform_admins` row
  automatically.
- **Emergency recovery if all admin rows are somehow removed:** there is no
  in-app recovery path by design (mirroring `platform_admins` having no
  client write path at all) — recovery is the same trusted Supabase
  dashboard SQL access used to manage every other server-only concern in
  this project (e.g. `protect_shop_features`-guarded columns). Whoever
  holds Supabase project access is always able to re-`INSERT` an admin row
  directly.
- **Founders' initial bootstrap:** after this migration deploys, run the
  `INSERT` above once per founder directly via the Supabase SQL editor —
  not part of the migration itself, since no client write path exists by
  design and hardcoding founder UUIDs into the migration file would need a
  rewrite the moment admin membership changes.

## 8. Rollout-flag lifecycle: cleanup rule

Rollout flags are temporary engineering controls, not permanent product
configuration — unlike WAFI-131's pack flags, which are permanent
entitlement state. Every rollout flag added to `ROLLOUT_FLAG_KEYS` should
have an implicit owner and an expected cleanup point: once the new
implementation it gates is fully rolled out and the old code path is
deleted, remove the flag from every layer that references it — call sites,
the TypeScript registry, the SQL allowlist in `set_rollout_flag`, the
return shape/query in `list_shops_for_rollout_admin`, the admin UI (which
already auto-derives its columns from the registry, so this step is free
once the registry entry is gone), and, optionally, the now-dead
`rollout.<key>` values left sitting in `shops.features` rows (harmless to
leave, since a resolver call for a since-removed key simply never happens
again — no migration required to clean up the stale JSON). Skipping this
is how a "temporary" rollout flag becomes permanent dead configuration.

## Explicitly deferred (documented, not implemented in this ticket)

- **Returning the effective value from `set_rollout_flag`:** the RPC stays
  `RETURNS void`. The UI already knows what it requested and applies it
  optimistically; a `RETURNS boolean` echo of the effective value would be
  a minor robustness improvement (useful if this RPC's semantics ever
  become less deterministic) but isn't required for v1's synchronous,
  single-writer-at-a-time usage pattern.
- **A `useRolloutFlag()` reactive composable:** not introduced now. The
  underlying risk it would guard against — a component capturing
  `isRolloutEnabled(key)` once into local state instead of reactively —
  is addressed by the consumer invariant in Section 3 (don't cache a
  rollout decision beyond the lifecycle boundary that needs it); a
  `computed(() => flags.isRolloutEnabled(key))` at each call site is
  sufficient today. If multiple consumers end up repeating this pattern,
  extracting the composable is a small, low-risk follow-up, not something
  to build speculatively now.
- **Server-side rollout consumers:** today, every rollout consumer is a
  Vue client reading synced `shops.features` via PowerSync. If a future
  phase (e.g. the business-services extraction this ticket exists partly
  to de-risk) adds server-side consumers (an API, a background worker), it
  must read through a shared server-side resolver with the same
  fail-closed contract as `resolveRollout` — not re-interpret
  `shops.features` independently. No code needed for WAFI-155; noted here
  so the constraint isn't lost by the time it's relevant.
- **Rollout-change audit trail:** WAFI-155 does not add an in-app history
  of who changed which flag when. Changes remain traceable only through
  Supabase/database-level logs. A dedicated audit trail (who/when/old
  value/new value, surfaced in the admin screen) is a reasonable follow-up
  if operational frequency or a real incident ever justifies the added
  scope — not built speculatively here.
- **`shops.updated_at`:** checked — `shops` has no `updated_at` column in
  the schema at all (confirmed against `001_initial_schema.sql`), so this
  is not applicable; no change needed on this point.

## Open items for the implementation plan

- Confirm the actual next-available migration number against
  `supabase/migrations/` at implementation time (this repo has a history
  of migration-number collisions, e.g. the historical dual-038 bug fixed
  during the local-Supabase-stack repair effort).
- Confirm the exact set of columns Supabase's generated TypeScript types
  need regenerating for after adding `platform_admins` and the two new
  RPCs (part of the paired-edit convention in Section 2).
