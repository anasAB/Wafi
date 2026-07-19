# ADR-009 — Server-side financial-data enforcement via a device-scoped role claim

| Field      | Value                       |
|------------|-----------------------------|
| Date       | 2026-07-19                  |
| Status     | Proposed (spike output — not yet implemented) |
| Deciders   | Anas Baaj (CTO), PO         |
| Supersedes | None (extends, does not reverse, the tenant-isolation model in ADR-004; deliberately reopens the "no custom JWT hook" choice made when migration 014 / `jwt.ts` were removed) |

## Design Correction (2026-07-19, post-implementation)

During Task 4's implementation review, the original mechanism described
below (client embeds `device_id` via `signInWithPassword({ options: { data:
{ device_id } } })`, hook reads it back off the session) was found to be
**broken for two independent reasons**, verified against real
Supabase/GoTrue behavior:

1. `signInWithPassword`'s `options` object does not support a `data` field
   at all -- that shape exists only on `signUp`'s options. The `device_id`
   claim never reaches the server on sign-in; the client-side change
   (commit 6f446c9) was a no-op and has been reverted.
2. Even if it had reached the server, it would have landed in
   `auth.users.raw_user_meta_data` -- a single column on the ONE account
   row per shop (WAFI-119's one-account-per-shop model), not per-session
   state. Two devices signed into the same shop account would stomp each
   other's value; there is no way for that column to hold two different
   device identities at once.

**The fix**: Supabase JWTs already carry a genuine per-session `session_id`
claim by default -- stable across token refreshes of the same login
session, changing only on a brand-new sign-in. The whole mechanism is
re-keyed on `session_id` instead of `device_id`. This requires **no
client-side claim embedding at sign-in at all** (unlike the broken
approach) -- `session_id` is already present in `event.claims` for the
Custom Access Token Hook to read directly. `device_sessions` gains a
`session_id` column (partial unique index, nullable) as the new lookup
key; `device_id` remains the table's PK and stays as informational
device-management context. `switch_active_operator` gains a `p_session_id`
parameter and stamps it into the same upsert that already writes
`active_role`. See migration `048_session_id_active_role.sql` for the full
implementation.

Everything else in this ADR -- the RPC's role, the fail-closed lockout,
the tenant-scoping-only-via-`shop_id` constraint, the Architecture
Guidelines below -- is unchanged. Only the claim name and its source
(platform-provided vs. client-embedded) changed.

**Not yet verified** (see updated Review Date section): whether
`session_id` is genuinely present in the Auth Hook's `event.claims` in a
live Supabase project, and whether the client SDK's `Session` object
exposes `session_id` directly (needed so a later task can pass it to
`switch_active_operator`) versus requiring the client to decode its own
JWT payload manually.

## Context

WAFI-122 (formerly WAFI-010) requires that financial data — cost fields,
profit aggregates, expenses, supplier costs — never reach a cashier's device
at all, not just be hidden by client-side UI gating
(`src/router/permissions.ts`). Today `permissionsForRole()`/`canUserDo()` are
the only gate; a cashier with browser dev tools can read every cost, margin,
and expense field already present in their local PowerSync SQLite database.
This blocks WAFI-138's staff-ledger/settlement write endpoints from merging
to `main` (see `docs/WAFI-138-139-staff-settlement-revised.md`) and is
tracked as its own gating ticket in `docs/FEATURE_TICKETS_2026-07-17.md:871`.

**The ticket's own three proposed options (per-role sync buckets,
column-level exclusion, separate financial tables) all silently assume the
sync layer can already tell which staff role is active on a given session.
It cannot.** Per `powersync.yaml` and WAFI-119, sync identity is the
Supabase Auth account, and **one account = one shop**, shared across every
staff member on that shop via in-app PIN switching — not per-staff logins.
Every device signed into a shop's single account receives the exact same
sync stream regardless of which staff member is currently PIN-unlocked on
it. None of the three proposed shapes can be built without first giving the
sync layer *some* way to know the active role — this spike's real job was
finding that mechanism, not picking among the three original options
directly.

## Decision

Introduce a **device-scoped role claim**, carried in the Supabase JWT and
re-resolved on every token refresh, so `powersync.yaml` streams can branch
their queries on `request.jwt() ->> 'active_role'`.

1. **New table `device_sessions`**: `device_id` (PK, matches the existing
   `devices` table's identity), `shop_id`, `active_staff_id`, `active_role`,
   `updated_at`. One row per registered device — whichever staff member is
   currently PIN-unlocked on it.
2. **New `SECURITY DEFINER` RPC `switch_active_operator(device_id, staff_id,
   pin)`**: verifies the PIN server-side against `staff.pin_hash`, then
   upserts `device_sessions` for that device. This is the *only* write path
   to `active_role` — never a raw client update, so a compromised client
   cannot self-elevate.
3. **Custom Access Token Hook** (Supabase Auth Hook, Postgres function):
   Supabase populates a genuine per-session `session_id` claim on every
   token by default -- no client action needed to put it there. On every
   mint/refresh, the hook reads `session_id` off the incoming claims, looks
   up `device_sessions.active_role` for it (via the `session_id` column,
   re-keyed by `switch_active_operator` on each PIN switch), and stamps the
   current value into `active_role` on the token. *(See Design Correction
   above: the original design read a client-embedded `device_id` claim
   instead; that path was confirmed broken and replaced with this
   platform-provided `session_id` claim.)*
4. **Forced refresh on PIN switch**: immediately after
   `switch_active_operator` succeeds, the client calls
   `supabase.auth.refreshSession()`, so the new role claim is live within
   one sync cycle rather than waiting for a natural token expiry.
5. **`powersync.yaml` branches per table that carries cost/profit data**:
   two query variants gated by `active_role` — e.g. `products` syncs with
   `cost_price_usd` for `owner`/`manager` roles, without it for `cashier`;
   `expenses`, `stock_receivings`/`stock_receiving_line_items`,
   `stock_take_lines` (cost fields), `suppliers` payment terms, and the new
   `staff_ledger`/`staff_settlements` tables from WAFI-138 all get an
   equivalent split.

## Alternatives Considered

| Option | Why Rejected |
|--------|--------------|
| Per-role sync buckets / column exclusion / separate financial tables, as originally scoped in the ticket | All three assume sync identity already varies by role. It doesn't — every device on a shop's one account gets one sync stream. None of these is buildable without first solving the role-visibility problem this ADR addresses; they become the *mechanism* for branching once this ADR's claim exists, not competing top-level designs. |
| Real per-staff-member Supabase Auth accounts (one login per cashier/manager/owner, not one per shop) | The textbook-correct fix, and the ticket's own edge-case note ("align with WAFI-119's account model") gestures at this as a future direction. Rejected for this pass because it cascades into WAFI-119's whole tenancy model (RLS keyed on `shops.owner_user_id` would need generalizing to a shop-membership table), is a multi-week rearchitecture, not a "weeks, sync-rule surgery" ticket, and blocks on WAFI-119 already being CRITICAL/in-flight. Revisit if/when WAFI-119 moves toward multi-account shops. |
| Client-supplied `device_id` as a PowerSync subscription **parameter** (no JWT hook), with the parameter query itself scoped by `auth.user_id()` | Avoids reopening the JWT-hook decision entirely. Considered viable — a parameter query like `SELECT active_role FROM device_sessions WHERE device_id = subscription.parameter('device_id') AND shop_id IN (SELECT id FROM shops WHERE owner_user_id = auth.user_id())` is legitimately scoped, since the client can claim any `device_id` string but the row lookup stays confined to the authenticated account's own shop. Rejected in favor of the JWT-claim approach only because CTO's stated preference was the JWT-hook route; **flagged as a lower-risk fallback** if the Auth Hook route hits an unexpected platform limitation during implementation (see Review Date below). |
| Do nothing server-side; rely on tightened client-side gating only | Does not meet the ticket's actual requirement (server as the guarantee) and leaves the dev-tools exposure the ticket exists to close. |

## Consequences

**Positive:**
- Closes the actual gap: a cashier's local SQLite genuinely never receives
  cost/profit/expense rows, verifiable by direct DB inspection (WAFI-122's
  first acceptance criterion).
- Role changes propagate within one sync cycle via the forced refresh,
  meeting the ticket's stated criterion without waiting on natural token
  expiry.
- `device_sessions` reuses the existing `devices` table's identity rather
  than inventing a new one, and the RPC's PIN re-verification means the
  server, not the client, is the source of truth for "who is currently
  operating this device" — consistent with `executeFinancialWrite()`'s
  existing "server/DB layer as the real guarantee, client as UX" pattern
  from WAFI-138.

**Negative / trade-offs:**
- **Reopens the "no custom JWT claim/hook" decision** made when migration
  014 and `jwt.ts` were deleted (see tenant-isolation notes). That earlier
  choice avoided JWT hooks entirely in favor of the
  `shops.owner_user_id → auth.user_id()` mapping for tenant scoping. This
  ADR does not touch tenant scoping (shop isolation stays exactly as-is);
  it adds a *second*, narrower claim solely for intra-shop role
  differentiation. The two mechanisms are independent, but this is still a
  deliberate reversal of "avoid JWT hooks" as a blanket rule, and should be
  read by future engineers as "we do use one JWT hook, for role only, not
  for tenant scoping."
- **A device physically shared between a cashier's morning shift and the
  owner's evening use** only reflects the *last PIN switch's* role until
  the next switch/refresh — not real-time per-keystroke isolation. This
  matches the ticket's own accepted edge case ("bucket switch on operator
  change is NOT feasible... document that per-operator on one shared
  owner-account device remains client-gated"); the server guarantee applies
  per signed-in *session*, refreshed at each explicit operator switch, not
  continuously.
- **Existing sessions must reauthenticate/refresh** to pick up the new
  claim shape after this ships — a rollout step, not a blocker, but must be
  sequenced (see Definition of Done below).
- **COGS-derivability**: the profit-trend/report code paths must be
  re-audited to confirm nothing lets a cashier back-compute cost from
  visible price + margin-adjacent fields once cost columns are actually
  withheld — this ADR does not itself audit every report; that is
  explicitly listed as follow-up implementation work, not spike scope.

## Architecture Guidelines

- `active_role` is a **role-visibility claim only** — never use it for
  tenant/shop scoping. Shop isolation remains exclusively
  `shops.owner_user_id = auth.user_id()`, per ADR-004 and the existing RLS
  policies across every table. Do not let `active_role` leak into any
  `shop_id` filter.
- `switch_active_operator` is the only writer of `device_sessions`. Do not
  add a second write path (e.g. a raw client `UPDATE`) — the PIN
  re-verification inside the RPC is the entire security property.
- Any new table carrying cost/profit/expense data must get the same
  two-variant sync-stream treatment in `powersync.yaml` as the tables
  listed in the Decision section — this is not a one-time fix scoped to
  today's schema.
- The Custom Access Token Hook must fail closed: if it cannot resolve
  `active_role` for a `device_id` (row missing, device never registered), it
  must default to the most restrictive role (`cashier`), never to
  `owner`/`manager`.

## Review Date

Before implementation begins: prototype the Custom Access Token Hook
against Supabase's actual platform behavior for multi-session claim
persistence (does a `refreshSession()` on device A's session actually only
affect device A's token, or does Supabase's hook model make this
per-account rather than per-session in practice?). If the hook cannot be
scoped per-session as assumed, fall back to the client-supplied
subscription-parameter approach listed under Alternatives Considered before
proceeding further — this must be confirmed in the implementation phase's
first days, not assumed from this ADR alone.

**Added 2026-07-19 (post-implementation, see Design Correction above):**
the same "confirm against the live platform before shipping" caveat now
applies to `session_id` specifically. Two things remain unverified against
a real Supabase project: (1) that `session_id` is genuinely present in the
Auth Hook's `event.claims` object for every mint/refresh, not just some;
(2) whether the client SDK's `Session` object exposes `session_id` as a
directly readable field, or whether the client must decode its own JWT
payload to obtain it (needed so a later task can pass it as
`p_session_id` to `switch_active_operator`). Do not ship this mechanism
until both are confirmed.

Revisit this whole design if/when WAFI-119 moves toward real per-staff-member
Supabase accounts — at that point, per-role sync buckets keyed on the
account itself (the ticket's original, simpler proposal) become directly
buildable and this device-claim mechanism can likely be retired.

## Related

- Ticket: `docs/FEATURE_TICKETS_2026-07-17.md:871` (WAFI-122)
- Gating relationship: `docs/WAFI-138-139-staff-settlement-revised.md`
- Tenant isolation baseline: ADR-004; the sync-scoping model this ADR
  extends without altering: `powersync.yaml`
- Auth/account model this ADR is deliberately NOT changing: WAFI-119
  (`docs/FEATURE_TICKETS_2026-07-17.md:779`)
