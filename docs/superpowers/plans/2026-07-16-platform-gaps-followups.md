# Wafi POS — Platform Gaps Follow-Ups

> Date: 2026-07-16
> Source: external product feedback (mislabeled against `2026-06-23-profit-report-design.md` — actually platform-wide) + codebase audit confirming each point against current implementation.
> Severity: **P0** business-model blocker · **P1** daily-operations correctness · **P2** high-value/low-effort feature · **P3** deferred / strategic decision, not a gap.
> Rejected/already-covered points are listed at the bottom for the record, not as tickets.

---

## P0 — Business-model blockers

### WAFI-068 — Real Auth + server-side role enforcement is still "post-trip drafted," not shipped
**Area:** auth, RLS · **Evidence:** `docs/superpowers/plans/2026-06-20-epic-real-auth-onboarding-device-registration.md:4` ("Drafted, next epic after the trip"), `2026-06-20-epic-server-side-role-enforcement.md:4` ("Drafted; depends on Real Auth"), `supabase/migrations/015_rls_tenant_scoping.sql` (RLS scopes by shop only, not by role), `src/router/permissions.ts:23,70-71` (role gating is 100% client-side).
The Staff Pack (+$5/mo) is sold on "trust and accountability" — cashier shift accountability, audit log, permissions. All of that currently rests on a shared login with client-side UI gating only. A cashier who opens DevTools can read owner-only financial data or bypass a permission check; nothing on the server stops them.
**Acceptance Criteria:**
- Real Auth epic ships before any new premium (paid-pack) feature is built.
- Server-side role enforcement (RLS or equivalent) blocks owner-only reads/writes for a non-owner session, not just the client router.
- Verified: a cashier-role session cannot fetch owner-only financial rows via a raw API call (not just via the UI).

---

## P1 — Daily-operations correctness (will surface in week one of real use)

### WAFI-069 — No cross-currency change calculation
**Area:** payment · **Evidence:** `src/features/payment/usePayment.ts` `changeDue` (lines 51-59) and `buildEntry()` (91-110) only compute change in the same currency as the tender (USD tender → USD change, SYP tender → SYP change).
Daily occurrence in a dual-currency/hyperinflation market: customer pays $20 USD for a $10.50 sale, cashier gives $0.50 change in SYP at the current rate because the drawer has no USD coins. Not supported today.
**Acceptance Criteria:**
- Payment flow allows change to be issued in a different currency than the tendered payment, converted at the sale's locked exchange rate.
- Receipt/sale record shows the tendered currency/amount and the change currency/amount separately.
- Test: $20 USD tender on a $10.50 sale, change requested in SYP, records match `(20 - 10.50) * rate` SYP.

### WAFI-070 — Device time is unverified (shift/sale timestamps spoofable)
**Area:** shifts, payment · **Evidence:** `src/features/shifts/composables/useShift.ts:150,186,347`, `src/features/payment/usePayment.ts:161` — every timestamp is raw `new Date()`. No NTP/server-time reconciliation or spoofing flag exists anywhere in the repo.
A cashier hiding a shift discrepancy can change the device clock to alter shift-close timestamps or which day a sale lands in. Low effort, real fraud vector once the Staff Pack's cash-accountability story matters.
**Acceptance Criteria:**
- Shift open/close and sale-creation timestamps are validated or corrected against a server/network time source when online.
- When offline, a `device_time_used: true` (or equivalent) flag is recorded on the row so a later reconciliation can flag suspicious local-clock sales.
- Test: device clock set backward mid-shift → shift close is flagged or corrected, not silently trusted.

### WAFI-071 — No generic ESC/POS printer driver
**Area:** printing · **Evidence:** `src/composables/usePrinter.ts` defines `IPrinterDriver` but the only implementation is `SimulatedDriver` (line 40) — no Epson/Star/generic driver exists yet.
~80% of target shops in Syria/MENA use $30 generic Chinese ESC/POS printers (Xprinter, Goojprt, HPRT) over USB/Bluetooth, not the named brands in the hardware list. This is pre-existing scope (Sacred Rule #3, hardware week), not a regression — but it needs an explicit "generic ESC/POS" driver, not just Epson/Star-specific ones, or pilot shops fail on day one.
**Acceptance Criteria:**
- A generic ESC/POS driver (works across the common clone chipsets) exists alongside any brand-specific drivers.
- Verified against at least one real generic USB or Bluetooth thermal printer, not just the simulated driver.

---

## P2 — High-value, low-effort features

### WAFI-072 — No "Park/Hold Sale"
**Area:** pos · **Evidence:** no park/hold/suspend-cart code found; `useSaleDraft.ts` only auto-persists the single current in-progress cart for crash recovery, not multiple parked carts.
Customer steps away mid-sale (forgot wallet, running to the ATM) with a line behind them. Without park/hold, cashiers cancel and re-ring later, corrupting sale counts and frustrating the next customer.
**Acceptance Criteria:**
- Cashier can park the current cart and start a new sale; parked carts list is retrievable and resumable.
- Parking/retrieving a cart does not create a phantom sale record or break the sale sequence.

### WAFI-073 — Low-stock alert has no reorder follow-through
**Area:** inventory, messaging · **Evidence:** WhatsApp messaging infra exists (`src/features/messaging/whatsapp.ts`, `WhatsAppPreviewSheet.vue`) for installment reminders/owner digests, but nothing generates a reorder list from low-stock products.
Low-stock alert today is passive. Turning it into a "Generate Reorder List" action (plain list or pre-filled WhatsApp message to a supplier) converts a notification into a workflow, reusing messaging infra that already exists.
**Acceptance Criteria:**
- A "Generate Reorder List" action on the low-stock view produces a list (or WhatsApp-prefilled message) of low-stock products with suggested quantities.

### WAFI-074 — No Z-report day lock
**Area:** shifts/audit · **Evidence:** no date-based lock logic found in shift/Z-report code (`useShift.ts`, `shift.store.ts`) or the audit log; past days are viewable/filterable but nothing prevents editing.
Once a shift/day is closed, past sales should be soft-locked — viewable, but editable/deletable only with an owner PIN and an audit log entry. Currently nothing enforces this.
**Acceptance Criteria:**
- After a day's shift(s) close, its sales cannot be edited/deleted without an owner PIN override, which itself writes an audit log entry.

---

## P3 — Deferred or already covered (tracked, not new tickets)

- **First-5-minutes onboarding wizard** (3-step: currency+rate, printer test, add 3 products manually) — real gap (`OnboardingPage.vue` is a checklist/progress dashboard, not a guided wizard), but scoped as a v1.5+ conversion-funnel improvement, not urgent relative to P0/P1 above. Revisit once real pilot feedback shows the Excel-import path is the actual first-run blocker for small catalogs.
- **Remote wipe / device deactivation** — partially covered: `useStaff.ts`'s `deactivateStaff()` revokes a *person's* access with an audit event, but there's no device-level revoke/wipe. Folds naturally into the Real Auth epic's device-registration work (WAFI-068) rather than being a separate ticket.
- **Accountant/tax-export mapped to Qoyod/ZATCA-style columns** — **rejected, not a gap.** CLAUDE.md explicitly locks "NOT Qoyod-shape" (accounting-first horizontal is a different category/strategy — lines 44, 287, 377, 423, 427). Building tax-mapped exports now would contradict a deliberate strategic decision. Worth revisiting only if/when a KSA/UAE expansion with mandatory e-invoicing (ZATCA) becomes a real year-3+ plan.
- **Price locked at first cart item** — **already shipped.** `useSale.ts` (lines 52-61) snapshots `unitPriceUsd`/`listPriceUsd` onto the cart line at add-time; a mid-sale product-price edit elsewhere cannot reprice the open cart (WAFI-002 already covers the equivalent invariant for exchange rate).
- **Negative-stock sale hard block** — **already shipped, feedback's framing was off.** `useSale.ts` (lines 45-48) already hard-blocks adding a product to the cart once its stock is exhausted; there's no Manager-PIN override path because oversell isn't reachable through the UI in the first place. The only related flag (`oversold:<n>` note in `usePayment.ts:264-271`) is a stale/offline-drift reconciliation aid, not a live overselling permission gap.
