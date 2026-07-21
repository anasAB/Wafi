# WAFI-122 RPC Audit

Every `SECURITY DEFINER` function bypasses RLS by definition. Each one below
answers the four required questions (design spec §6) as of migrations
through 062.

## `switch_active_operator(device_id, session_id, staff_id, pin)`

- **Bypasses RLS?** Yes.
- **Why?** Must read `staff.pin_hash`/`pin_salt` to verify a PIN for a staff
  member who is not yet the authenticated JWT's identity — no RLS-visible
  caller identity exists yet at the moment this function runs.
- **What validates authorization inside it?** Re-verifies the PIN
  server-side (`sha256(salt+pin)` via pgcrypto) against the shop resolved
  from `devices.shop_id = auth_shop_id()` (tenant boundary enforced inside
  the function body, since SECURITY DEFINER means the caller's own RLS
  does not apply). Fails closed on lockout (`locked_until`), on missing/
  inactive staff, and on PIN mismatch — identically, so no response-shape
  signal distinguishes failure reasons.
- **Which tables does it touch?** Reads `devices`, `staff`, `device_sessions`
  (the lockout check reads the existing session row before writing it);
  writes `device_sessions`.
- **Which audit entries does it write?** None currently. Flagged as a gap:
  an `operator.switched` audit event (already listed as a required event
  type in TICKET-007/WAFI-138's audit expansion) should be added when that
  ticket wires audit calls into this RPC.

## `allocate_device_code(...)`

- **Bypasses RLS?** No. Unlike `switch_active_operator`, this function has
  no `SECURITY DEFINER` clause (migration 037) — it is `LANGUAGE plpgsql`
  with no security qualifier, so it defaults to `SECURITY INVOKER` and
  runs as the calling role, fully subject to the caller's own RLS
  policies.
- **Why?** It does not need to bypass RLS: it only reads `devices` to
  count existing codes for the shop, and the `devices_select_all` RLS
  policy (defined in this same migration) already scopes that read to
  `shop_id = auth_shop_id()`. There is no pre-authentication or
  cross-tenant step here that would require a SECURITY DEFINER escape
  hatch the way `switch_active_operator` needs one to read `staff.pin_hash`
  before the caller has an established identity.
- **What validates authorization inside it?** Ordinary RLS on `devices`
  (`devices_select_all`, `devices_insert_all`, `devices_update_all` from
  migration 037), scoped to `shop_id = auth_shop_id()`. No internal
  tenant-boundary check is needed inside the function body, since it isn't
  SECURITY DEFINER — RLS already applies.
- **Which tables does it touch?** Reads `devices` (a `SELECT COUNT(*)` to
  find the next free code). It does not itself write to `devices` — the
  actual device row insert happens in caller code
  (`useDeviceRegistration.ts`), not inside this RPC.
- **Which audit entries does it write?** None currently — same gap as
  above, tracked for TICKET-007/WAFI-138.

## No other `SECURITY DEFINER` functions

No other `SECURITY DEFINER` functions exist in this codebase as of
migration 062 (confirmed via `auth_shop_id()`, `auth_permissions()` in
Task 2, which are themselves SECURITY DEFINER but are read-only helpers,
not mutating RPCs, and are exempt from this audit's "which tables does it
touch to mutate" framing — they only SELECT).

Any future financial-write RPC must add its own section here, answering
all four questions, before merge (per design spec §6 and CLAUDE.md's ADR
requirement for significant decisions).
