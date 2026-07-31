# Discount Caps Settings — Validation & Silent-Failure Fix

Status: Approved (design), pending implementation plan
Source: QA bug report (BUG-01 through BUG-08) against `src/features/pos/DiscountCapsSettingsScreen.vue`, build v0.1.5

## Problem

The Discount Caps settings screen (owner-editable Cashier/Manager discount
authorization thresholds) has no functional client-side validation and
misreports save success:

- The Save button is not inside a `<form>`, so the existing `min="0"
  max="100"` HTML attributes never trigger native validation.
- `useDiscountCaps.ts` writes directly to the local PowerSync SQLite
  table, which has no range constraint (only the Postgres table does,
  via a `CHECK` in `052_sale_discounts.sql`).
- The "تم الحفظ" (Saved) toast fires on the local write, before any
  server round-trip, so out-of-range or invalid values appear to save
  successfully and "persist" on reload (the app always reads local
  SQLite) while silently failing to reach Supabase in the background.
- There is no cross-field rule preventing a Cashier cap from exceeding
  the Manager cap, defeating the tiered-approval purpose of the feature.
- Both inputs lack accessible names, and Enter does not submit the form.

Root cause is shared across BUG-01, 02, 03, and 05: invalid/out-of-range
values are never stopped before they enter the PowerSync CRUD queue, and
the app has no way to notice or surface an upload that failed after the
fact. BUG-04, 06, 07, 08 are smaller, independent issues bundled into
this same spec since they touch the same component and form wiring.

## Approach

Validate everything client-side before any write happens, so invalid
values never enter the sync queue at all (offline-first-safe: no
dependency on a round-trip to know a value was well-formed). Add a local
SQLite CHECK as defense in depth. Separately, monitor the PowerSync
upload queue after a valid write so a same-value-but-failed-to-sync case
(BUG-05's failure mode) is surfaced instead of silently swallowed.

## Design

### 1. Form & validation (`DiscountCapsSettingsScreen.vue`)

- Wrap both inputs in a real `<form @submit.prevent="submit">` so Enter
  submits (fixes BUG-08) and native attributes stop being misleading
  dead weight.
- On submit, run explicit validation before calling `caps.save(...)`:
  - Empty field → inline error "الرجاء إدخال قيمة", required field (not
    silently coerced to 0). Fixes BUG-06 by making the transformation
    explicit and blocking instead of silent.
  - Non-numeric / non-finite → inline error, block save.
  - Out of `0 ≤ value ≤ 100` range → inline error, block save. Closes
    BUG-02.
  - More than 2 decimal places (matches `NUMERIC(5,2)`) → inline error,
    block save. Combined with the range check, this closes BUG-03 by
    construction — a 20-digit string fails range long before precision
    loss is reachable.
  - Cross-field: `cashierInput > managerInput` → inline error, hard
    block (no save path around it). Closes BUG-04.
- All errors render inline next to the relevant field. Save button
  stays enabled after a validation failure — no dead-end state.
- Nothing is written to PowerSync until all checks pass.

### 2. Confirmation dialog

Before the validated values are written, show a confirmation dialog:
"سيتغير الحد الأقصى للكاشير من X% إلى Y%" (and the equivalent line for
Manager if it also changed). The actual write only fires on confirm.
This closes the audit/accidental-change gap called out in the report's
Requirement Gaps section.

### 3. Local schema hardening + upload-failure surfacing

- Add the same `>= 0 AND <= 100` CHECK constraint to the PowerSync local
  schema definition (`src/data/powersync/schema.ts`) for
  `cashier_discount_cap_pct` / `manager_discount_cap_pct`, so an
  out-of-range value can never land locally even if client validation is
  bypassed or has a bug. Defense in depth, not a replacement for #1.
- After the local write succeeds, watch the PowerSync CRUD upload queue
  status for this row. If the upload for this specific change errors out
  or is rejected:
  - Downgrade the toast from "تم الحفظ" to an explicit failure state:
    "لم يتم الحفظ على الخادم — سيُعاد المحاولة" (Not saved to the
    server — will retry).
  - Do not leave the user believing a stale success toast reflects
    reality. This directly targets BUG-05: a success toast must never
    be the last word if the write is later known to have failed or been
    superseded.
- Out of scope for this spec: root-causing *why* a valid write's upload
  might fail/revert (e.g. a genuine PowerSync/Supabase race on the
  `shops` row) — that's an infra investigation ticket. This spec's job
  is to make failures visible, not to guarantee they never occur.

### 4. Accessibility (BUG-07)

Add `<label for="cashier-cap-input">` / `<label
for="manager-cap-input">` (or `aria-label` if a visible label is
undesirable) to both inputs: "الحد الأقصى للخصم – الكاشير" / "الحد
الأقصى للخصم – المدير".

### 5. Owner cap (Requirement Gap)

No schema or UI change. Add static helper text under the form: "الأصحاب
غير مقيدين بحد أقصى" (Owners are not subject to a discount cap) so the
omission reads as an intentional design choice, not a missing feature.

## Non-goals

- Regression-testing other settings screens for the same PowerSync
  write pattern (personal settings, invoice settings, return reasons,
  scanner, devices) — separate ticket, per the report's Regression
  Risks section.
- Re-verifying that `src/features/pos/useDiscountAuthorization.ts`
  reads a fresh (non-stale) cap value at point-of-sale — separate
  ticket.
- Automated regression tests (API/E2E for the range, hierarchy, and
  rapid-save race scenarios listed in the report's Automation
  Candidates section) — covered by the implementation plan's test task,
  not itself a design decision.

## Cross-Epic Edge-Case Checklist (design time)
Domains touched: Sales (discount authorization is consumed by
`useDiscountAuthorization.ts` at point-of-sale)
Matrix rows consulted: Sales (`Key composables: usePayment` — discount
cap values feed into the discount-authorization check gating this flow,
though this spec does not modify `usePayment` or the Sales row itself)
Open cross-feature questions: none identified — this spec only changes
how the Cashier/Manager cap values are validated and saved, not how
they're consumed at sale time; a stale-read risk at POS is called out
as a separate non-goal ticket above.
