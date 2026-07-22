# WAFI-122 Role Enforcement: Automated pgTAP Suite — Design

## Background

`WAFI_Production_Readiness_Plan_v3.md`'s WAFI-001 row lists four still-open
items even though the core RLS/auth mechanism (WAFI-122) and the sales-table
tightening (WAFI-202/WAFI-203) have shipped:

1. No automated DB-level role×table test suite — only a manual SQL script,
   `supabase/migrations/verification/verify_wafi122_role_enforcement.sql`,
   hand-run against a live Supabase project.
2. Live exploit test stands in for a full pentest, but a formal one is still
   not performed.
3. No final security sign-off document.
4. (Resolved by WAFI-202/WAFI-203, no longer open.)

This ticket closes item 1: convert the manual script's automatable sections
into a pgTAP regression suite, following the precedent already set by
`supabase/tests/wafi202_sales_immutability.test.sql` — the first (and so far
only) automated pgTAP suite in this codebase, run via `npx supabase test db`.

Items 2 and 3 are out of scope here — a formal pentest and a sign-off
document are not code-executable tasks; they need a human with access to a
live/staging Supabase project and are tracked separately.

## Scope

`verify_wafi122_role_enforcement.sql` has four sections:

- **Section A** (role-based access, happy path) — 5 assertions
- **Section B** (negative/edge cases) — 6 assertions
- **Section C** (lifecycle) — 2 assertions
- **Section D** (manual penetration test) — 2 live REST `curl` checks against
  a real deployed project

Sections A–C (13 assertions total) are pure SQL-and-RLS checks — exactly the
shape pgTAP automates. Section D requires a real HTTP round-trip against a
deployed Supabase REST endpoint with a genuine cashier JWT extracted from a
live session; there is no local-Postgres equivalent, so it **stays manual**
and is explicitly out of scope for this suite.

## Design

### New file: `supabase/tests/wafi122_role_enforcement.test.sql`

Follows `wafi202_sales_immutability.test.sql`'s established conventions
exactly (same file wraps `BEGIN`/`plan(13)`/`finish()`/`ROLLBACK`, same
`set_config('request.jwt.claims', ..., true)` + `SET LOCAL ROLE authenticated`
per-case pattern, same UUID-prefixed fixture-row style):

**Fixtures** (Shop A is the primary tenant under test, Shop B exists purely
for the cross-tenant checks):

- Shop A: one `auth.users` row (owner), one `shops` row, one `devices` row,
  one `products` row, one `cashier_shifts` row (opened by cashier-1).
- Shop A staff: owner, manager (baseline — real permissions, active), two
  cashiers (so Section A5 can prove a manager sees *both* cashiers' sales,
  not just their own).
- Shop A staff (edge-case rows, needed only for Section B): a manager with
  `permissions` set to a non-JSON string (B3), a manager with
  `is_active = false` (B4), a manager with every permission flag explicitly
  `false` in valid JSON (B5).
- Shop A sales: one sale per cashier (cashier-1 and cashier-2), both
  attributed via `staff_id` on the shift-opening cashier's own row and a
  second sale inserted directly with cashier-2's `staff_id` — proving A4/A5
  need genuinely different owners, not just different rows.
- Shop B: one `auth.users` row (owner), one `shops` row, one `staff` row
  (a cashier), for B6/C2's cross-tenant checks.

**13 test cases**, each following the pattern: `set_config(...)` with the
case's JWT claims, `SET LOCAL ROLE authenticated`, then one pgTAP assertion
(`ok()`, `is()`, `lives_ok()`, or `throws_ok()` as fits):

| # | Source | Assertion |
|---|---|---|
| 1 | A1 | Cashier SELECT `staff` → 0 rows |
| 2 | A2 | Owner SELECT `staff` → > 0 rows |
| 3 | A3 | Cashier SELECT `audit_log` → 0 rows |
| 4 | A4 | Cashier-1 SELECT `sales` → every row's `staff_id` = cashier-1's own id |
| 5 | A5 | Manager SELECT `sales` → sees cashier-1's AND cashier-2's sales (count ≥ either cashier's own count) |
| 6 | B1 | JWT with no `active_role` claim → `auth_role()` fails closed to `'cashier'` → `staff` SELECT still 0 rows |
| 7 | B2 | JWT with `active_role: cashier`, no `staff_id` → `sales` SELECT (own-sales policy) → 0 rows, since `staff_id = NULL` never matches |
| 8 | B3 | Manager with malformed (non-JSON) `permissions` → `can('can_view_reports')` = `false`, no error raised |
| 9 | B4 | Deactivated manager → `can('can_manage_products')` = `false` even though the flag itself is `true` on the row |
| 10 | B5 | Manager with every flag `false` → `can('can_manage_products')` = `false` |
| 11 | B6 | Shop-B staff id queried while JWT resolves Shop A (via owner's `auth_shop_id()`) → `staff` SELECT → 0 rows |
| 12 | C1 | Manager's `can_view_reports` flipped `true`→`false` via a live `UPDATE`, same JWT claims re-run → `can('can_view_reports')` = `false` immediately, no refresh needed |
| 13 | C2 | Same shape as B6, framed as "device reassigned to a different shop" per the manual script — cross-tenant boundary is claims-independent |

(B6 and C2 are the same underlying check per the manual script's own note
that "this is exercised the same way as B6" — both are kept as separate
pgTAP assertions for 1:1 traceability back to the manual script's numbering,
even though they exercise the same code path.)

### Housekeeping

Update `verify_wafi122_role_enforcement.sql`'s header comment (it already
has a precedent for this — its current header describes WAFI-202's suite
covering the sales tables) to add a parallel note: Sections A–C now have
automated pgTAP coverage via the new suite; Section D remains manual by
nature (live REST endpoint + real JWT) and stays the only way to verify that
specific check. The manual script remains useful as an additional pre-deploy
sanity check against a real project (environment drift a local pgTAP run
can't catch), per the same rationale already stated for the WAFI-202 note.

Also update `WAFI_Production_Readiness_Plan_v3.md`'s WAFI-001 row: item 1
("no automated DB-level role×table test suite") becomes resolved, with a
pointer to the new suite. Items 2 (pentest) and 3 (sign-off doc) remain open
— the row's final "Do not treat as done until..." sentence is updated to
drop the resolved item but keep the still-open ones.

## Acceptance Criteria

- [ ] All 13 assertions from Sections A, B, C are present as pgTAP test
      cases in the new suite, each traceable back to its manual-script
      source case by comment.
- [ ] Suite runs via `npx supabase test db` (requires local Docker/Postgres
      — same execution gap already flagged for WAFI-202's suite; if no such
      environment is available in this session, the suite is built and its
      assertions are manually traced against the actual RLS policies /
      helper functions the same way WAFI-202's suite was, with the same
      caveat recorded that real execution proof is still pending a human
      with Docker).
- [ ] Cross-tenant isolation (B6/C2) is proven, not just role/permission
      checks — Shop B's fixtures exist and are queried under Shop A's JWT.
- [ ] `verify_wafi122_role_enforcement.sql`'s header updated to point at the
      new suite for Sections A–C.
- [ ] `WAFI_Production_Readiness_Plan_v3.md`'s WAFI-001 row updated to
      reflect the closed item.

## Out of Scope

- Section D (live REST pentest) — inherently manual, not a pgTAP case.
- A formal third-party penetration test (WAFI-001 open item 2) — separate,
  needs a human, not addressed here.
- A final security sign-off document (WAFI-001 open item 3) — separate,
  needs a human decision, not addressed here.
- Any change to the RLS policies, helper functions, or migrations themselves
  — this is a test-only addition; if the suite finds a real bug, that
  becomes its own follow-up, not silently fixed inside a "just add tests"
  ticket.
