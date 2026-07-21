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
- **Which tables does it touch?** Reads `devices`, `staff`; writes
  `device_sessions`.
- **Which audit entries does it write?** None currently. Flagged as a gap:
  an `operator.switched` audit event (already listed as a required event
  type in TICKET-007/WAFI-138's audit expansion) should be added when that
  ticket wires audit calls into this RPC.

## `allocate_device_code(...)`

- **Bypasses RLS?** Yes (SECURITY DEFINER, migration 037).
- **Why?** Runs during device self-registration, before the device has an
  established session/role.
- **What validates authorization inside it?** Tenant boundary via the
  caller's resolved `shop_id`; no role check needed since device
  registration is not role-gated by design (any device belonging to the
  shop can register itself).
- **Which tables does it touch?** `devices`.
- **Which audit entries does it write?** None currently — same gap as
  above, tracked for TICKET-007/WAFI-138.

## No other `SECURITY DEFINER` functions exist in this codebase as of
migration 062 (confirmed via `auth_shop_id()`, `auth_permissions()` in
Task 2, which are themselves SECURITY DEFINER but are read-only helpers,
not mutating RPCs, and are exempt from this audit's "which tables does it
touch to mutate" framing — they only SELECT).

Any future financial-write RPC must add its own section here, answering
all four questions, before merge (per design spec §6 and CLAUDE.md's ADR
requirement for significant decisions).
