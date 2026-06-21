# Epic — Server-Side Role Enforcement

> Date: 2026-06-20
> Status: Drafted (post-trip; **depends on** the Real Auth epic)
> Pack: Core / Staff (foundational security)
> Owner: CTO (dev)
> Origin: audit ticket **WAFI-010** (PO decision 2026-06-20: build server-side enforcement).
> Sacred Rules touched: Offline-first (1) — *in tension, see Key Decision 2*.

---

## Thesis

Today permissions are decorative. Because there is **one Supabase account per shop**,
every cashier shares the shop's database credential, so RLS can isolate shop-from-shop
but cannot tell a cashier from the owner. Any cashier who opens devtools — or hits
Supabase with the shop's anon key — can read the owner's profit, other staff's PIN
hashes, and the audit log. The role system exists only in the UI.

This epic makes role enforcement real at the server, so that "Cashier", "Manager",
and "Owner" mean something an attacker on a shop device cannot bypass. It is the
security half of the product's "see who's stealing" promise — and it is genuinely
hard, because enforcing per-staff roles on top of a shared shop account requires a
new identity layer and a deliberate decision about what stays available offline.

It builds on the Real Auth epic (which establishes the shop login + session) and is
the natural home for the server side of WAFI-009 (audit immutability), WAFI-012
(PIN hashing), and WAFI-013 (Manager matrix) enforcement.

---

## The core problem

```
ONE Supabase account = the shop. All staff PIN-in on top of it.
  → the shop's JWT/anon key carries NO staff identity
  → RLS / PostgREST / PowerSync see "the shop", not "this cashier"
  → every row the shop can read, any staff (or anyone with the key) can read
```

So enforcement needs two things that don't exist yet:
1. **A per-staff identity the server trusts** (distinct from the shop account).
2. **A decision about which data is sensitive**, and whether sensitive data is
   *gated at sync time* (stays offline for privileged users) or *served on demand*
   (online-only, never cached).

---

## Key Decisions (PO recommendation — dev confirms feasibility)

### KD-1 — How staff identity reaches the server
**Recommendation:** a short-lived **staff token** minted after PIN entry — an Edge
Function verifies the PIN server-side and returns a signed token carrying
`staff_id` + `role`. Sensitive operations go through role-checked Edge Functions (or
RLS that reads the staff token), not direct PostgREST/PowerSync.
*Bonus:* PIN verification moves server-side, so **PIN hashes need never sync to any
device** (resolves the WAFI-012 exposure at the root).

### KD-2 — Sync-time gating vs online-only (THE crux; resolves the offline tension)
Two ways to keep sensitive data from a cashier:
- **(A) Sync-time role gating** — the sync token carries staff role; a cashier
  device simply never receives sensitive buckets. **Privileged users keep offline
  access** (the owner's device syncs everything). Cost: sync must re-subscribe with
  a staff-scoped token when staff changes on a device.
- **(B) Online-only Edge Function** — sensitive data is never synced; fetched live
  with a role check. Simplest isolation, but **breaks offline** for those screens
  (owner can't see profit/audit offline).

**Recommendation:** use **(A) sync-time gating** for owner/manager-readable data
(profit, audit log, reports) so offline-first survives for privileged users; use
**(B)** only for data that should never touch a device at all (PIN hashes).

### KD-3 — Shared-device offline downgrade (the subtle one)
On a **shared** device the owner syncs sensitive data offline, then hands the device
to a cashier who PINs in **offline** — the sensitive rows are physically still in the
local DB. Sync-time gating (KD-2A) does **not** protect this case.
**Recommendation (PO):** treat the **physical-device + audit-log** model as the
boundary here (consistent with CLAUDE.md's "PIN is for speed; the audit log is the
defense"), AND on staff change clear/lock sensitive local tables. Document explicitly
that a shared device used offline by mixed roles is a trust boundary, not a
cryptographic one. *If that's unacceptable, sensitive data must be online-only (KD-2B)
and the offline cost accepted.*

### KD-4 — Offline PIN entry
Server-side PIN verification (KD-1) needs network. For shift continuity offline,
allow PIN entry against a **cached salted hash** for the local session, but require an
online staff token before any sensitive server operation. (So a cashier can open a
shift offline; reading the audit log offline is not available to them.)

---

## What is "sensitive" (the gated set)
**Role-gated (owner/manager only):** audit log, staff records + PIN hashes, profit /
cost / margin data and reports, shop settings, expense detail (owner/manager).
**Always available to cashier (synced, offline):** products, current sale, sales they
ring, customers, exchange rate, their own shift/Z-report.
*(Final list confirmed with the Manager matrix from WAFI-013.)*

---

## User Stories & Acceptance Criteria

### A — Staff identity at the server
**A1.** After PIN entry, the device obtains a server-trusted staff identity (role).
- A staff token (or equivalent) carrying `staff_id` + `role` is issued by a
  server-side check; the client cannot forge or elevate it.
- Token expires and refreshes; a role/permission change invalidates stale tokens.

**A2.** PIN verification is server-side; PIN hashes never sync to devices.
- The `staff.pin_hash` column is no longer in any synced bucket / client schema.
- Test: a device's local DB contains no PIN hashes; PIN check still works online;
  offline PIN works against a cached salted hash for shift continuity only (KD-4).

### B — Role-gated data
**B1.** A cashier cannot read sensitive data through any path.
- Direct PostgREST/anon-key reads of audit_log, staff, and profit/cost data return
  nothing for a cashier-role session.
- Test: with a cashier staff token (and with only the shop anon key), the audit log,
  other staff rows, and profit data are inaccessible.

**B2.** Privileged users keep permitted offline access (KD-2A).
- An owner/manager device syncs its permitted sensitive buckets and can read them
  offline.
- Test: owner views profit and audit log offline; cashier device has neither.

**B3.** Staff change re-scopes access.
- Switching staff on a device re-subscribes sync to the new role and clears/locks
  sensitive local data the new role may not see (KD-3).
- Test: owner (sees profit) → cashier PINs in → profit no longer readable on that
  device, online or offline.

### C — Enforcement integrity (ties existing tickets)
**C1.** Audit log is server-enforced append-only and role-gated (with WAFI-009).
**C2.** The Manager matrix (WAFI-013) is enforced server-side, not only in the UI:
a Manager can read products + reports but cannot read/write staff or settings via
the API.
**C3.** The client guard (WAFI-011) remains as the UX layer but is no longer the
*only* line of defense.

---

## Edge Cases (do not skip)
- **Shared-device offline downgrade** (KD-3) — sensitive rows already cached locally;
  cleared/locked on staff change, or kept online-only.
- **Offline PIN** (KD-4) — works for shift open; sensitive server reads require an
  online token.
- **Stale role token** after a permission/role change → invalidated; next sensitive
  op forces re-auth.
- **Token mint requires network** — first sensitive action of a session online;
  fail gracefully offline with a clear "needs internet for this" message.
- **Sync re-subscribe race** on staff switch → no window where the old role's data is
  still streaming to the new staff.
- **Owner's own (non-shared) device** — simplest path; everything syncs offline.

## Out of Scope
- Per-staff Supabase accounts (keeps the one-account-per-shop lock).
- Custom/flexible permission framework (v1.5).
- Field-level redaction beyond table/bucket-level gating.
- Tamper-evident cryptographic audit chaining (v2).

## Definition of Done
- [ ] A cashier session (token or bare anon key) cannot read audit log, staff/PINs,
      or profit data via any API/sync path (B1).
- [ ] PIN hashes are absent from every device's local DB; PIN check works online,
      offline shift-open works against a cached hash (A2, KD-4).
- [ ] Owner/manager read their permitted sensitive data offline; cashier does not
      (B2).
- [ ] Staff change re-scopes access with no leak of the prior role's data (B3, KD-3).
- [ ] Manager matrix enforced server-side (C2); audit log append-only + role-gated
      server-side (C1, WAFI-009).
- [ ] The KD-2 / KD-3 offline trade-offs are documented per sensitive surface.

## Risks
- **Biggest:** KD-3 (shared-device offline). There is no clean cryptographic answer
  while data is cached locally for offline use; the honest options are "online-only
  for the most sensitive" or "physical-device + audit-log trust boundary." Decide
  this explicitly before building.
- **Offline-first regression.** Every surface pushed online-only (KD-2B) is a Sacred
  Rule #1 exception — keep the list minimal and deliberate.
- **Sync re-subscribe on staff switch** adds latency/complexity to PIN login; test
  the offline path.
- **Scope creep into a permission framework.** Hold the line: three hardcoded roles
  enforced server-side, not a general engine (that's v1.5).
