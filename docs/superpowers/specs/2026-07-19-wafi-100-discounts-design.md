# WAFI-100 — Line & Sale Discounts with Owner-Set Caps and Audit Trail

**Date:** 2026-07-19
**Source ticket:** `docs/FEATURE_TICKETS_2026-07-17.md` § WAFI-100
**Status:** Approved for planning

## Context / prior-art finding

The cart already has an unstructured price-editing mechanism:
- `SalePanel.vue` renders a free-form `<input type="number">` bound to `line.unitPriceUsd`,
  writing through `sale.store.ts`'s `updateUnitPrice(productId, price)` — no cap, no PIN,
  no audit trail.
- `SaleLine` already carries `listPriceUsd` alongside `unitPriceUsd`, and the cart UI shows
  a ▲/▼ delta badge when they differ.
- `usePayment`'s `scalePricesToTotal` also rewrites all line prices proportionally when an
  "overpaid" cash amount is treated as a negotiated higher total.

This is effectively an existing, uncontrolled discount (and markup) mechanism. WAFI-100
must close this bypass, not merely add a parallel capped mechanism next to it.

## Decisions (confirmed with product owner)

1. **Replace, don't coexist.** The raw price-edit input is removed. All price movement
   below list price goes through the new capped/audited discount affordance.
2. **Markup (selling above list) stays uncapped, no PIN.** It never hurts the shop
   financially. Kept as a separate, simple `+amount` control — same net UX as today's ▲
   indicator — outside the discount system entirely.
3. **Caps are per-role only** (`cashier`, `manager`), not per individual staff member.
   Stored at the shop level, owner-editable. (Owner is never capped.)
4. **Line and sale-level discounts stack.** A sale-level discount applies on top of the
   already-net line total. Caps are checked independently: line cap against the tier
   price in effect (retail price today; wholesale tier once WAFI-110 lands), sale-level
   cap against the post-line-discount subtotal.

## Data model

New migration (next free number after 044, e.g. `045_discounts.sql`):

- `shops.cashier_discount_cap_pct NUMERIC DEFAULT 0`
- `shops.manager_discount_cap_pct NUMERIC DEFAULT 15`
- `sale_line_items`:
  - `discount_type TEXT CHECK (discount_type IN ('percent','fixed')) NULL`
  - `discount_value NUMERIC NULL`
  - `discount_amount_usd NUMERIC NOT NULL DEFAULT 0`
  - `unit_cost_usd NUMERIC NULL` — cost snapshot at sale time; not currently persisted
    server-side (client has it transiently), needed for the below-cost guard and for
    WAFI-107's anomaly flags to consume without re-deriving.
  - `tier_price_usd NUMERIC NULL` — forward-compat placeholder for WAFI-110; unused
    until two-tier pricing lands.
- `sales`:
  - `sale_discount_type TEXT CHECK (sale_discount_type IN ('percent','fixed')) NULL`
  - `sale_discount_value NUMERIC NULL`
  - `sale_discount_amount_usd NUMERIC NOT NULL DEFAULT 0`

All discount amount columns are derived and immutable once written.

## Client cart (`src/store/sale.store.ts`, `src/features/pos/`)

- `SalePanel.vue`: remove the raw price `<input>`. Replace with a discount affordance
  (tap to open a sheet: percent or fixed, shows tier price struck-through + discount +
  final, per the ticket's cart-transparency requirement) and a separate lightweight
  markup `+amount` control.
- `sale.store.ts`:
  - `updateUnitPrice` is retired as a public write path; replaced by
    `applyLineDiscount(productId, {type, value})`, which computes `unitPriceUsd` from
    `listPriceUsd`, and stores `discount_type/value/amount` on the line.
  - `applyMarkup(productId, amountUsd)` — separate, uncapped, unaudited path for
    selling above list.
  - New `saleDiscount: { type, value, amountUsd } | null` for the sale-footer discount.
  - `totalUsd` becomes `sum(line net totals) − saleDiscountAmountUsd`.
  - `scalePricesToTotal` (used by the fast-cash "overpaid = negotiated price" path) needs
    to be reconciled with the new discount fields — either routed through
    `applyLineDiscount`-equivalent math or explicitly documented as a markup-only path
    (needs a decision during implementation; flagging here rather than guessing).

## Cap + PIN authorization

- New composable `useDiscountAuthorization(role, capPct)`:
  - Below-cost check: `(price after discount) < unitCostUsd` → PIN required regardless
    of cap (hard guard, overrides everything).
  - Otherwise: `discountPct > capForRole` → PIN required.
  - Owner role: never requires PIN.
- Reuses the existing `PinPad.vue` sheet component (same pattern as other owner-PIN
  flows in the app). Declined PIN = discount not applied, line/sale reverts to
  pre-discount state.

## Rate lock interaction

Fixed-amount discounts entered while the sale is denominated in SYP convert using
`saleStore.lockedExchangeRate` — never the live rate — consistent with WAFI-002.

## Returns (`src/features/returns/composables/useReturnSheet.ts`)

Must be audited during implementation to confirm it refunds the line's *net*
`unitPriceUsd` (post-discount) rather than `listPriceUsd`. This is the highest
invariant-risk area per the ticket's integration warning and needs its own
investigation pass before changes land (not fully scoped by inspection alone yet).

## Audit trail

New `AuditEvent` variants in `audit.types.ts`: `sale.discount_applied` (and reuse of
existing sale entity type). New `logDiscountApplied` helper in `useAuditLog.ts`,
following the `_logSensitive` pattern (below-cost / PIN-approved discounts are
accountability-critical, so a failed audit write must surface, not silently vanish).
Meta fields: `operator_id`, `tier_applied`, `base_price_used`, `discount_type`,
`discount_value`, `final_price`, `pin_approval`, `below_cost` — matching the ticket's
required audit granularity for WAFI-107 to consume later.

## Z-report

New per-operator "total discounts given" rollup, sourced from `sale_line_items` and
`sales` discount columns for the shift's sales.

## Settings UI

Owner-only screen (gated by `can_manage_settings`) to set `cashier_discount_cap_pct`
and `manager_discount_cap_pct`, following the existing Settings screen patterns (e.g.
`DenominationSettingsScreen.vue`).

## Testing plan

- Unit tests: percent/fixed discount math, SYP fixed discount at locked rate, line +
  sale-level stacking order, below-cost hard-guard override of role cap.
- Returns-of-discounted-line test (net refund).
- Full offline sale → return → Z-report cycle test, verifying discount totals surface
  correctly at each stage.
- PR includes an invariants-impact note per the ticket's Definition of Done.

## Open questions carried into planning

- Exact interaction between `applyLineDiscount` and `scalePricesToTotal` (fast-cash
  overpay path) needs to be resolved with actual code investigation, not just design —
  flagged for the implementation plan / TDD phase rather than guessed here.
- Exact migration number depends on what else has landed by the time this is built
  (numbering collisions have happened before in this repo — coordinate at implementation
  time).
