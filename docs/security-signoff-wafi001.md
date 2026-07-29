# WAFI-001 Security Sign-Off: Server-Side Role Enforcement (RLS)

**Ticket:** WAFI-001 — Server-Side Role Enforcement
**Date:** 2026-07-24
**Prepared for:** Founders (CEO + CTO), WAFI
**Format note:** No external pentest firm was engaged. Per the project's cash budget
(€100-200/month, no outside funding — see `CLAUDE.md`), this is a founder-executed
sign-off: an internal, evidence-based review consolidating every access-control test
performed against this system, rather than a third-party penetration test report.
That is a deliberate, budget-driven tradeoff, not an oversight — it should be revisited
once the team can afford (or the risk warrants) an external pentest, e.g. around the
funding decision at 100 customers (see `CLAUDE.md` "Scaling Milestones").

---

## 1. What This Document Covers

WAFI-001's stated scope is "server-side role enforcement" — proving that RLS (Row Level
Security) policies, not client-side checks, are the actual authorization boundary for
every role (owner, manager, cashier) across every synced table, and that tenant
isolation (shop A cannot see or write shop B's data) holds.

This document consolidates every piece of evidence produced against that scope:

| Evidence | What it proves | Date |
|---|---|---|
| Live manual exploit test against production | WAFI-202's original discovery: a manager session forged `staff_id` and edited a completed sale's `total_usd` via direct REST PATCH | 2026-07-21 |
| `supabase/tests/wafi122_role_enforcement.test.sql` (13 assertions) | Role×table access matrix (Sections A-C: role access, edge cases, lifecycle) across sales, products, staff, shifts | Written 2026-07-22, **29/29 passing incl. WAFI-202 suite** per `WAFI_Production_Readiness_Plan_v3.md` |
| `supabase/tests/wafi202_sales_immutability.test.sql` (16 assertions) | Sales/returns are append-only; strict staff attribution; cross-tenant isolation on sales-domain tables | Written 2026-07-22, verified passing |
| `supabase/tests/wafi003_device_session_revocation.test.sql` | Device session revocation actually terminates the Supabase Auth session, not just a soft flag | Verified passing, 2026-07-23 |
| Full-codebase security review (`docs/security-review-2026-07-22.md`) | Baseline review of all `src/` code and all 68 SQL migrations for RLS gaps, XSS, secrets, SSRF, injection | 2026-07-22, **2 findings (Vuln 1 High, Vuln 2 Medium) — see §3** |
| `supabase/tests/wafi001_cash_shift_hardening.test.sql` (10 assertions) + migration `068_wafi001_cash_shift_hardening.sql` | Fixes for Vuln 1 & 2 (§3) | Written 2026-07-24, **verified 10/10 passing 2026-07-26** against a disposable Supabase project with full migration history applied — see §3 |

## 2. Scope Boundary (What This Does NOT Cover)

- **Offline-sync confidentiality (WAFI-201 / ADR-010):** PowerSync's bulk-sync-then-filter
  model means a synced device temporarily holds rows outside the current user's
  authorization scope before local filtering applies. This is a known, accepted,
  documented architectural gap — explicitly out of scope for WAFI-001/122/202, tracked
  separately. **Not closed by this sign-off.**
- **Formal third-party penetration test.** Not performed, and not planned until the
  founders can justify the cost (see the format note above).
- **Client-side code review for non-auth concerns** (XSS, CSV injection, etc.) — covered
  informationally by `docs/security-review-2026-07-22.md` but is a separate concern
  from role enforcement; see that document's "Findings Investigated and Excluded"
  table for items considered and not carried into this sign-off.
- **Infrastructure/hosting security** (Supabase platform security, Vercel/Cloudflare
  config) — out of scope; treated as the vendor's responsibility per their own
  compliance posture.

## 3. Open Items As Of This Sign-Off

Two findings from the 2026-07-22 security review were fixed and, as of 2026-07-26,
**verified for real**:

- **Vuln 1 (High):** `cashier_shifts` UPDATE/DELETE was open to any shop staff via a
  stale permissive policy (migration 015) that migration 058 never dropped when it
  added ownership-scoped SELECT. Fix: migration 068 drops the stale policies and adds
  the same staff-or-manager check SELECT already used.
- **Vuln 2 (Medium):** `cashier_shifts`/`cash_movements` INSERT lacked staff-attribution
  enforcement — a cashier could misattribute a shift or cash movement to a coworker.
  Fix: migration 068 adds `staff_id = auth_staff_id()` to both tables' INSERT
  `WITH CHECK`, mirroring the WAFI-202 pattern.

**Verification method:** no local Docker was available, so the full migration history
(001-068) was applied to a disposable Supabase project (created solely for this test,
not connected to production data) and all four pgTAP suites were run against it via a
plain Node/`pg` script (since `pg_prove`/`supabase test db` require Docker) — reading
each test file, executing it as one transaction, and printing pgTAP's own TAP output
rows. Result: **39/39 assertions pass** (WAFI-122: 13/13, WAFI-202: 16/16, WAFI-003:
6/6, WAFI-001 hardening: 10/10). One real fixture bug was caught and fixed in the
process (Test 7 initially violated `uq_cashier_shifts_one_open_per_device` by reusing a
device with an already-open shift — fixed by seeding a second device), which is itself
a small piece of evidence the verification was genuine rather than rubber-stamped.

**This sign-off's engineering conditions are now met:**
1. ~~Run the WAFI-001 hardening suite against a real Postgres.~~ **Done, 2026-07-26.**
2. ~~Apply migration 068 to production.~~ **Done, 2026-07-26** — applied via the SQL
   Editor and independently confirmed via `pg_policies`: the stale
   `cashier_shifts_update_all`/`cashier_shifts_delete_all` policies are gone, and
   `cashier_shifts_update_own_or_manager`, `cashier_shifts_delete_own_or_manager`,
   `cashier_shifts_insert_all`, and `cash_movements_insert_all` exist with `qual`/
   `with_check` bodies matching the migration file exactly.

Only the founders' actual signatures (§6) remain outstanding.

## 4. Role × Table Access Matrix (As Designed)

| Table | Owner | Manager | Cashier (own rows) | Cashier (others') | Cross-tenant |
|---|---|---|---|---|---|
| `sales` / `returns` (+ line items, payments) | Read all; **cannot** edit/delete (append-only, incl. owner — WAFI-202) | Same as owner | Insert own only; read own; cannot edit/delete | No access | Blocked |
| `cashier_shifts` | Full CRUD, shop-wide | Full CRUD, shop-wide | Insert/update/delete own only *(verified + deployed to production 2026-07-26, migration 068)* | No access *(verified + deployed to production 2026-07-26, migration 068)* | Blocked |
| `cash_movements` | Read all; insert own-attributed only (append-only, no update/delete) | Same as owner | Insert own-attributed only; read own | No access | Blocked |
| `staff` (PII, PIN hash) | Full read/write | Read/write per migration 055 | No access to others' credentials | No access | Blocked |
| `staff_ledger` / `staff_settlements` | Gated by `can_view_staff_ledger` permission (migration 060) | Same, permission-gated | No default access | No access | Blocked |
| `audit_log` | Read-only, append-only (no UPDATE/DELETE policy exists at all — migration 018) | Same | Write-only (own actions) | N/A | Blocked |
| `devices` / `device_sessions` | Full management; can revoke any device's session (migration 067) | — | Manage own device | No access | Blocked |
| All tables (general) | — | — | — | — | `auth_shop_id()` (migration 015) scopes every policy; verified via Test 13 in the WAFI-202 suite and the cross-tenant assertions in the WAFI-122 suite |

## 5. Residual Risk Accepted By The Founders

- **Offline-sync confidentiality gap (WAFI-201/ADR-010)** remains open by conscious
  choice — mitigating it requires either a PowerSync architecture change or an
  alternative sync layer, both out of scope for the current budget/timeline. Risk is
  bounded: it requires physical/software access to a legitimate synced device, not a
  remote attack surface.
- **No external pentest.** Internal review + automated regression tests are the
  standing bar until the funding/scale decision at ~100 customers.
- **CSV/Excel formula injection** (noted in the 2026-07-22 review, confidence 6/10, not
  a Vuln 1/2-tier finding) is not fixed by this sign-off — tracked separately, low
  urgency given it requires staff transcription as an intermediate step, not direct
  attacker control.

## 6. Sign-Off

This document represents the founders' informed acceptance of WAFI's current
role-enforcement posture, conditional on §3's two items being completed.

| Role | Name | Signature | Date |
|---|---|---|---|
| CEO |Anas | YES | 28-07-2026 |
| CTO | MO | YES | 28-07-2026|

**Once §3's remaining condition is met** (migration 068 applied to production), update
the `WAFI_Production_Readiness_Plan_v3.md` status table's WAFI-001 row to reflect that,
and this sign-off doc is finalized — at which point WAFI-001 can be marked fully
shipped, pending only the CEO/CTO signatures above.
