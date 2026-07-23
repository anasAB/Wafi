# WAFI-004: Owner Bootstrap & Onboarding Design

**Date:** 2026-07-23
**Status:** Approved
**Ticket:** WAFI-004 (P1, 0.5 sprint, "Guided setup, <5 minutes, demo data option")

## Context

Unlike WAFI-002/WAFI-003, investigation found this ticket's gaps are real,
not already-built-and-undocumented:

- `SignupPage.vue` is a genuine 3-step signup (phone/password → business
  info → a "start goal" choice: `sell` / `inventory` / `explore`). On
  success it writes the chosen goal to `store.startGoal`
  (`src/store.ts:10`) and navigates to `/setup-owner`.
- `OwnerSetupScreen.vue` is not a wizard — it's `StaffForm` with
  `force-role="owner"` (PIN creation only), then `router.push('/')`.
  `store.startGoal` is **written once and never read again** — a
  ready-made hook sitting unused.
- `OnboardingPage.vue` is a real, well-built progress hub (4 cards:
  add products / open POS / add staff / complete profile,
  `src/features/onboarding/useOnboardingProgress.ts`), but it's
  **orphaned** — no route ever lands there automatically.
- `ExchangeRateEditor.vue` is a complete, reusable modal (validation, a
  "large change" confirmation, `close`/`saved` emits) surfaced today only
  via a persistent header widget — nothing prompts a brand-new owner to
  set it (Sacred Rule #2: "exchange-rate as prominent action").
- No demo-data seeding exists anywhere in the codebase.

## What's changing

This requires **zero new migrations** — `products.created_via`
(migration 051) is a plain `text` column with no `CHECK` constraint, so a
new tag value is just a new string, and `useProducts().save()` already
accepts a `createdVia` parameter end-to-end (audit logging included). All
three changes below are client-side only.

### 1. Route by `startGoal` after PIN setup

`OwnerSetupScreen.vue`'s `onDone()` currently always does
`router.push('/')`. It changes to branch on `store.startGoal`:

- `'sell'` → `/pos`
- `'inventory'` → `/products/add`
- `'explore'` → seed demo products (see #3), then `/onboarding`

`store.startGoal` is a plain `reactive()` field (not Pinia-persisted), so
this only works within the same browser session as signup — acceptable,
since `/setup-owner` is reached immediately after signup in the same
session today, and a missing/empty `startGoal` (e.g. a reload mid-flow)
falls back to the current behavior (`/`) via a default case.

### 2. First-run exchange rate prompt

`OwnerSetupScreen.vue` shows `ExchangeRateEditor.vue` as a modal right
after the PIN step completes, before the `startGoal` routing above. It is
skippable (a "تخطي الآن" / "skip for now" affordance alongside the
existing cancel), not a hard block — consistent with this app's existing
non-blocking philosophy (e.g. feature-flag gating never breaks an
in-progress screen). Skipping or saving both proceed to the same
`startGoal`-based routing in #1; the header widget remains how the rate
gets changed afterward.

### 3. Demo product seeding for the "explore" goal

A new composable, `useDemoDataSeed.ts` (or similar — implementer's call
on exact naming, matching this codebase's `use*` convention), seeds 5
generic-retail sample products via `useProducts().save({ ..., createdVia:
'demo_seed' })` when `startGoal === 'explore'`. Products only — no demo
customers or sales, to avoid touching the sales/customer domains
(immutability rules from WAFI-202, audit logging semantics) for a feature
whose entire point is a quick look, not a realistic operating history.

Sample data (generic retail per the Strategic Locks — Year 1 vertical is
general retail, not electronics-specific; brother's shop is one example,
not the vertical):

| name_ar | price_usd | cost_price_usd | current_stock |
|---|---|---|---|
| مياه معدنية ١.٥ لتر | 0.50 | 0.30 | 50 |
| شيبس بطاطا | 1.00 | 0.60 | 30 |
| صابون استحمام | 1.50 | 0.90 | 20 |
| شاي علبة ١٠٠ غرام | 2.00 | 1.20 | 15 |
| سكر كيلو | 1.20 | 0.80 | 25 |

**Idempotency guard:** before seeding, check the shop's current product
count (`useProducts().load()` then `products.value.length === 0`, or an
equivalent direct count query) and skip seeding if any products already
exist — protects against a double-run if `/setup-owner` is somehow
revisited. This mirrors the "only act on a genuinely fresh state" pattern
already used elsewhere in this codebase (e.g. `provision_shop_for_new_user`'s
own `IF EXISTS ... RETURN NEW` idempotency check, migration 021).

**Cleanup is out of scope for this ticket** — a "clear demo data" action
in Settings (`DELETE FROM products WHERE created_via = 'demo_seed'`) is a
natural, cheap follow-up given the tagging, but wasn't requested and adds
UI surface this ticket doesn't need.

## Testing

- **Vitest:** `OwnerSetupScreen.vue`'s routing branches (mock `store`,
  assert `router.push` target for each of `sell`/`inventory`/`explore`/
  empty-string default); the exchange-rate modal shows/skip/save paths
  don't block navigation; `useDemoDataSeed`'s idempotency guard (skips
  when products already exist) and its seed call shape (5 products,
  `createdVia: 'demo_seed'`).
- Manual: sign up as a brand-new owner through all three goal choices,
  confirm each lands where designed and (for `explore`) that 5 products
  appear tagged `demo_seed` and are indistinguishable in the POS/product
  list from real products.

## Out of scope

- A "clear demo data" Settings action (natural follow-up, not requested).
- Demo customers or demo sales (deliberately excluded — see #3 above).
- Enforcing a strictly-ordered onboarding wizard beyond the existing
  `OnboardingPage.vue` hub — the hub's flexible, checklist-style design
  is being kept, not replaced.
- Any change to `SignupPage.vue` itself (already a real, working 3-step
  flow) or to `ExchangeRateEditor.vue`/`useExchangeRate.ts` (reused as-is).
