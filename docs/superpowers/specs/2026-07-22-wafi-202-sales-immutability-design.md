# WAFI-202: Sales/Returns Immutability RLS Fix — Design

## Background

WAFI-001 (Server-Side Role Enforcement) was delivered under ticket WAFI-122
(migrations 055-062, ADR-010), but its own sales-domain migration
(`056_sales_domain_rls.sql`) explicitly deferred tightening UPDATE/DELETE on
`sales`, `sale_line_items`, `sale_payments`, `returns`, `return_line_items` —
those five tables kept the original migration-015 policies, which check only
`shop_id`, with no staff-attribution or immutability guard. Tracked as
WAFI-202.

This gap was **confirmed via a live exploit test against the hosted project**
(2026-07-21), not merely inferred from reading policy text: a manager-role
session successfully changed `total_usd` on a completed sale it didn't create
and forged `staff_id` attribution to the shop owner, via a direct PATCH to
the Supabase REST API. Row was reverted immediately after the test; no
lasting data impact.

**Precise scope** (narrower than a first static policy read suggested,
because Postgres requires a row to pass a table's SELECT policy before an
UPDATE/DELETE policy is even consulted):
- Owner/manager: can tamper with or delete **any** sale/return in the shop.
- Cashier: limited to sales they can already see (their own, per the existing
  SELECT policy) — but for those, the same lack of guard applies.
- No cross-tenant exposure — tenant isolation held throughout testing.

## Confirmed Constraints

- `sales` has no lifecycle `status` column (draft/completed/voided). The only
  status-like column is `sync_status` (offline-sync bookkeeping, unrelated to
  business state) — confirmed against both the migration files and the live
  schema.
- No legitimate client code path ever issues `UPDATE sales`, `UPDATE
  sale_line_items`, `UPDATE sale_payments`, `UPDATE returns`, or `UPDATE
  return_line_items` anywhere in `src/` (verified by search). `sync_status`
  is written once, as part of the initial `INSERT` in `usePayment.ts`.
- Corrections to a completed sale happen exclusively through a new `returns`
  row referencing it — never by editing the original `sales` row.

This means all five tables can become genuinely **append-only** from the
client's perspective with no functional carve-out needed, matching the
"immutable financial history, append-only ledgers" invariant already stated
in the project constitution.

## Design

### 1. RLS Migration

New migration `064_wafi202_sales_immutability.sql` (next free sequential
number — 063 is already taken by `063_backfill_staff_permissions.sql`),
following the expand-contract pattern (no destructive
drops of columns/tables — only policy changes):

For each of `sales`, `sale_line_items`, `sale_payments`, `returns`,
`return_line_items`:

- **Drop** the inherited `<table>_update_all` and `<table>_delete_all`
  policies (originally created by the migration-015 loop). No replacement
  policy is created for UPDATE or DELETE — Postgres RLS defaults to deny
  when no policy exists for a command, so these become fully denied to
  `anon`/`authenticated`. `postgres`/`service_role` are unaffected (used only
  for admin/support tooling, never by the app).
- **Replace** `<table>_insert_all` with an attribution-aware `WITH CHECK`:
  - `sales`: `shop_id = auth_shop_id() AND (staff_id = auth_staff_id() OR
    auth_role() IN ('owner','manager'))`. The owner/manager exception
    preserves existing product behavior (a manager can ring a sale on behalf
    of a cashier during training/co-serve); a bare cashier can only insert a
    sale attributed to themselves.
  - `sale_line_items` / `sale_payments`: attribution checked transitively
    through the parent `sales` row via the same `EXISTS` pattern migration
    056 already uses for their SELECT policies.
  - `returns`: same shape as `sales`, attributed via `shift_id` →
    `cashier_shifts.staff_id` (matching migration 056's existing
    `returns_select_own_or_manager` pattern, since `returns` has no direct
    `staff_id` column).
  - `return_line_items`: attribution checked transitively through the parent
    `returns` row.

### 2. Automated Regression Suite

New pgTAP test file, `supabase/tests/wafi202_sales_immutability.test.sql`,
run via `supabase test db` (Supabase CLI's built-in pgTAP support — no new
dependency to install). Uses the same `set_config('request.jwt.claims', ...)`
+ `SET LOCAL ROLE authenticated` simulation pattern validated by hand during
this investigation, wrapped in pgTAP `plan()`/`ok()`/`finish()` assertions
instead of manual inspection.

Test matrix:

| # | Test | Expected |
|---|---|---|
| 1 | Cashier inserts own sale | Allowed |
| 2 | Cashier inserts sale with another staff_id | Denied |
| 3 | Owner/manager inserts sale attributed to a cashier | Allowed |
| 4 | Cashier updates own completed sale | Denied |
| 5 | Owner updates any sale | Denied |
| 6 | Manager forges staff_id via UPDATE | Denied (regression test for the exact exploit confirmed live) |
| 7 | Cashier deletes sale | Denied |
| 8 | Owner deletes sale | Denied |
| 9 | Return creation (attributed via shift) | Allowed |
| 10 | Return update | Denied |
| 11 | Return delete | Denied |
| 12 | Staff from shop B cannot insert/update/delete shop A's sale | Denied (cross-tenant regression, since these policies are being touched anyway) |

### 3. Housekeeping

- Update `supabase/migrations/verification/verify_wafi122_role_enforcement.sql`'s
  header comment to point at the new automated pgTAP suite as the primary
  verification method going forward; the manual script remains as an
  additional pre-deploy sanity check, not the sole verification method.
- Update the WAFI-202 ticket doc and `WAFI_Production_Readiness_Plan_v3.md`'s
  WAFI-001 row to reflect "Fixed, regression-tested" once merged and the
  pgTAP suite passes in CI/locally.

## Out of Scope

- WAFI-201 (offline-sync confidentiality gap) — separate, already-accepted
  scope exclusion per ADR-010, not addressed here.
- A formal third-party penetration test — the live exploit-and-revert test
  performed during this investigation stands in as verification of this
  specific fix, but does not substitute for a broader pentest still tracked
  as an open WAFI-001 item.
- Any lifecycle `status` column (draft/completed/voided) on `sales` — not
  needed for this fix since the table becomes append-only outright; may be
  revisited later if a legitimate need for post-creation sale edits emerges.
