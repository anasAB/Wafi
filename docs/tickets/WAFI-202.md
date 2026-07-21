# WAFI-202: Close Sales/Cash Write-Attribution Gap (Direct-API INSERT/UPDATE/DELETE)

**Type:** Follow-up | **Priority:** P2 | **Depends on:** WAFI-122

**Problem:** WAFI-122 (migrations 056, 058) correctly scopes SELECT on
sales/sale_line_items/sale_payments/returns/return_line_items and
cash_movements/cashier_shifts so a cashier only sees their own rows. It
deliberately left INSERT open on all of these tables (a cashier must be able
to ring a sale / record a cash movement / open a shift), with no check that
`NEW.staff_id = auth_staff_id()` (or the equivalent shift-based attribution
for tables like `returns` and `return_line_items` that reach staff only
through `cashier_shifts`/`sales`). This means a cashier hitting the REST API
directly — bypassing the client UI, which always sets the correct
`staff_id` — could insert a sale or cash movement misattributed to a
different staff member. Separately, `sales` UPDATE/DELETE were left fully
open to every shop role: the original plan intended to lock these to
`status = 'draft'` (or equivalent), but the exact live values of
`sales.status` were not confirmed against a live schema during WAFI-122, so
that check was deferred rather than guessed at (see the deferred-scope
comment in migration 056).

**Goal:** Close the direct-API write-attribution gap — a cashier should not
be able to create a sale/cash movement/shift misattributed to another staff
member, nor edit or delete a completed sale, via a direct REST call that
bypasses the client UI.

**Investigate:**
1. Confirm `sales.status`'s actual live enum/text values (e.g. `draft`,
   `completed`, `voided` — whatever they turn out to be) via
   `information_schema` / a live query, not assumption.
2. Add `WITH CHECK (staff_id = auth_staff_id() OR auth_role() IN ('owner',
   'manager'))` to the INSERT policies on `sales` and `cash_movements`
   (owner/manager may need to insert on behalf of another staff member —
   e.g. correcting an entry — so the check should not block that).
3. For tables that only reach staff attribution indirectly (`sale_line_items`,
   `sale_payments` via `sales.staff_id`; `returns`, `return_line_items` via
   `cashier_shifts.staff_id`), add the equivalent EXISTS-based WITH CHECK,
   mirroring the SELECT policies' join pattern already in migration 056.
4. Add UPDATE/DELETE policies to `sales` scoped to `status = 'draft'` (or
   whatever the confirmed live enum's "not yet finalized" value is), so a
   completed sale can no longer be edited or deleted by any role via direct
   API.
5. Apply the same INSERT-attribution fix to `cashier_shifts` (a cashier
   opening a shift must have `staff_id = auth_staff_id()`).

**Definition of Done:** A written recommendation or implemented fix
(WITH CHECK clauses added to the relevant INSERT policies; UPDATE/DELETE
policies added to `sales` gated on the confirmed `status` column), with
verification that a cashier cannot insert/update a row attributed to another
staff member or edit/delete a completed sale via a direct REST call.
