# Wafi — Suggested Feature Tickets (18)

**Date:** 2026-07-17
**Source:** Product strategist evaluation (`docs/PRODUCT_EVALUATION_2026-07-17.md`) + feature suggestion sessions.
**Ticket range:** WAFI-100..117 (proposal range; renumber into the real backlog when picked up).

---

## ⚠️ READ FIRST — Compatibility & the Three Load-Bearing Walls

**No ticket below conflicts with an implemented feature. All 18 are compatible if built correctly.** However, **7 of the 18 touch one or more of the product's three load-bearing invariant systems** and will introduce bugs if built naively:

1. **The rate lock** — the SYP exchange rate is locked at the first cart line and never changes mid-sale (`useSale.ts` / `setLockedRate`).
2. **The payment accounting invariants** — `amount_usd` is net-of-change; cash totals come from `sale_payments`, not `payment_method`; credit sales write no payment row; returns reverse revenue/COGS per line; reconciliation is per-currency. (See memory doc: payment accounting invariants.)
3. **Drawer/shift attribution** — anything that moves physical cash must carry `shift_id` (and `device_id`) so the Z-report variance is correct. Expenses and customer_payments currently lack this (known gap); do not add a fourth unattributed writer.

**The 7 tickets with integration tensions:** WAFI-100 (discounts), WAFI-101 (quick-add/open-item), WAFI-102 (park/resume), WAFI-106 (supplier ledger), WAFI-110 (two-tier pricing), WAFI-113 (spot-check), WAFI-117 (practice mode). Each carries a red **INTEGRATION WARNING** block. Any PR for those tickets must include a short "invariants impact" note in the PR description.

**The 11 clean tickets:** WAFI-103, 104, 105, 107, 108, 109, 111, 112, 114, 115, 116 — no invariant impact beyond what's stated inline.

---

## WAFI-100 — Line & Sale Discounts with Owner-Set Caps and Audit Trail

**Priority:** Critical · **Effort:** ~1–2 weeks · **Depends on:** nothing

### Description
Add discounting to the POS cart: a per-line discount and/or a whole-sale discount, entered as either a percentage or a fixed amount (in the sale's locked currency context). Owner configures, per staff role, the maximum discount allowed without owner PIN approval (e.g., cashier ≤ 5%, manager ≤ 15%, above that → owner PIN prompt). Every applied discount is recorded on the sale and written to the audit log with operator identity.

### Why we need it
Syrian retail runs on haggling. Without in-system discounts, haggled sales are rung outside the system or fudged — which corrupts revenue, profit, Z-report and dashboard numbers. This is a **report-integrity feature**, not a convenience. With caps + audit, it also becomes an anti-abuse differentiator no local incumbent offers (owner can see who discounts how much).

### How it should act
- In the cart, each line gets a discount affordance; the sale footer gets a "sale discount" affordance.
- Entering a discount above the operator's cap opens the owner-PIN approval sheet (reuse existing PIN pad component).
- Discounted price is shown struck-through-original + new price on the line, in the receipt, and in sale history.
- Discount stored as: `discount_type (percent|fixed)`, `discount_value`, `discount_amount_usd` (computed, immutable), at line and/or sale level.
- Sale totals, `sale_payments`, COGS, and profit all compute from **net (discounted)** amounts.
- Z-report shows total discounts given in the shift, per operator.
- Audit log entry per discounted sale: operator, amount, % of sale, approver (if PIN-approved).

### 🔴 INTEGRATION WARNING
- **Accounting invariants:** discounts change `amount_usd` semantics. Rule: all stored monetary rollups are **net of discount**; the discount amount is stored separately for reporting. Revenue = net. COGS unchanged.
- **Returns:** returning a discounted line must refund the **net** price paid, not list price. `useReturnSheet` refund math must read the line's net amount.
- **Credit sales:** a discounted credit sale reduces the customer balance by the **net** total.
- **Rate lock:** fixed-amount discounts entered in SYP must convert using the sale's **locked** rate, not the current rate.

### Acceptance Criteria
- [ ] Cashier can apply a % or fixed discount per line and per sale; both visible on receipt and confirmation screen.
- [ ] A discount above the operator's role cap requires owner/manager PIN; declined PIN = discount not applied.
- [ ] Owner can configure caps per role in Settings (gated by `can_manage_settings`).
- [ ] Profit report, dashboard revenue, and Z-report all reflect net amounts; Z-report shows per-operator discount totals.
- [ ] Returning a discounted line refunds the net amount; partial return of a sale-level-discounted sale prorates correctly.
- [ ] Discounted credit sale reduces customer balance by net total; customer statement shows the net amount.
- [ ] Every discount writes an audit log entry with operator + approver.
- [ ] Works fully offline; discount data syncs with the sale in the same transaction.

### Definition of Done
Unit tests for discount math incl. returns-of-discounted-lines and SYP fixed discounts at locked rate; invariants doc updated; Z-report snapshot format versioned; QA pass on a full sale→return→Z-report cycle offline; PR includes invariants-impact note.

---

## WAFI-101 — Unknown-Barcode Quick-Add & Open-Item Sale Line

**Priority:** Critical · **Effort:** ~3–5 days · **Depends on:** nothing

### Description
Two related escape hatches so a sale is never blocked by a catalog gap:
1. **Quick-add:** scanning an unknown barcode opens a pre-filled sheet (barcode captured) → cashier types name + price (+ cost, see warning) → product is created and immediately added to the cart.
2. **Open item:** a cart button "بند حر / open item" → type name + price → sold without creating a product.

### Why we need it
The catalog-coverage gap is the weakest link of the inventory value loop: a missing product currently stalls checkout into full product creation or pushes the sale off-system. Quick-add also makes the catalog build itself during real trading — the biggest self-serve onboarding lever until the Excel import ships.

### How it should act
- Unknown scan (wedge or camera) → toast + quick-add sheet within one interaction; on save, line is in the cart, checkout continues.
- Quick-add products are flagged `created_via = 'quick_add'` and surfaced in Back Office as "needs review" (owner completes cost/category later).
- Open items create a sale line with `product_id = null`, stored name and price; no stock movement.
- Open items require `cost` = 0 explicitly flagged (see warning), and appear in a dashboard notice.

### 🔴 INTEGRATION WARNING
- **Profit/COGS:** a line with no cost silently inflates profit. Rules: (a) quick-add sheet asks for cost with a "skip" option; (b) any sold line with unknown cost is counted in a visible dashboard notice: "الربح لا يشمل N مبيعات بدون تكلفة" ("profit excludes N uncosted sales"). Never treat unknown cost as 0 silently.
- **Stock guard:** open items bypass stock logic by design — they must never create `stock_adjustments`.
- **Returns:** open-item lines must be returnable (refund by amount, no restock option).

### Acceptance Criteria
- [ ] Unknown barcode → quick-add sheet with barcode pre-filled; product saved + in cart in ≤ 3 fields (name, price, optional cost).
- [ ] Open-item button in cart; line prints on receipt with typed name.
- [ ] Quick-add products appear in a "needs review" filter in products list.
- [ ] Dashboard/profit report shows the uncosted-sales notice when applicable; notice clears when costs are filled in retroactively.
- [ ] Open items excluded from stock, stock take, and low-stock logic.
- [ ] Both flows work fully offline.

### Definition of Done
Tests for uncosted-line profit exclusion and open-item return; Arabic strings reviewed; QA: scan unknown code → sell → return, offline.

---

## WAFI-102 — Park / Resume Sale

**Priority:** Important · **Effort:** ~3–5 days · **Depends on:** nothing (builds on Dexie draft-cart layer)

### Description
Cashier can park the current cart (customer forgot wallet / stepped aside), serve the next customer, and resume the parked cart later. Multiple parked carts, labeled (auto-label = time + first item, editable).

### Why we need it
Standard capability in mature POS; directly serves the fastest-checkout philosophy at peak moments. The Dexie draft layer already persists a single cart — this generalizes it.

### How it should act
- "Park" button in cart → cart saved locally, POS cleared for next sale.
- Parked list accessible from POS screen (badge with count); tap to resume.
- Parked carts are **local-only** (device-scoped, not synced) and belong to the shift.

### 🔴 INTEGRATION WARNING
- **Rate lock collision:** a parked cart carries a locked rate. If resumed after the rate changed, the stale rate would drift totals — the exact bug the lock prevents. **Rules:** (a) all parked carts are **discarded at shift close** (with a confirm listing them); (b) on resume, if the current rate ≠ parked locked rate, the cart **re-locks to the current rate**, re-prices, and shows a notice: "تم تحديث السعر حسب صرف اليوم".

### Acceptance Criteria
- [ ] Park clears the POS in one tap; parked count badge visible.
- [ ] Resume restores lines, quantities, and customer selection.
- [ ] Resume after a rate change re-prices at current rate with a visible notice.
- [ ] Shift close warns about and discards parked carts.
- [ ] Parked carts survive app reload (local persistence) but never sync.

### Definition of Done
Tests for the re-lock-on-resume rule and shift-close discard; QA on phone form factor.

---

## WAFI-103 — Denomination-Based Cash Counting (Shift Open & Close)

**Priority:** Critical (cheap + protects the core pitch) · **Effort:** ~2–4 days · **Depends on:** nothing

### Description
Replace the blind "enter total" fields at shift open and Z-report close with an optional denomination tally: cashier taps counts per denomination for SYP and USD; the app computes totals. Breakdown is stored with the shift.

### Why we need it
SYP note counts make manual totaling slow and error-prone — and a counting error is indistinguishable from theft in the variance report. False variance erodes owner trust in the Z-report, which is the Staff Pack's whole value.

### How it should act
- Tally UI: denomination rows (configurable list per currency in settings; sensible SYP/USD defaults), +/- steppers and direct count entry, live total.
- "Enter total directly" remains as fallback.
- Breakdown stored as JSON on `cashier_shifts` (opening and closing); shown in shift detail as evidence.

### Acceptance Criteria
- [ ] Shift open and Z-report close both offer tally mode; totals feed existing fields unchanged.
- [ ] Denomination breakdown persisted and visible in shift history detail.
- [ ] Owner can edit the denomination list per currency in Settings.
- [ ] No change to variance math (inputs identical, just computed).
- [ ] Fully offline.

### Definition of Done
No invariant impact; snapshot of Z-report data includes breakdown; QA both currencies.

---

## WAFI-104 — Collections Worklist ("Who to Chase Today")

**Priority:** Critical (highest ROI/effort of all 18) · **Effort:** ~3–5 days · **Depends on:** nothing

### Description
A screen under Customers: all customers with outstanding credit, ranked by debt age × amount, showing balance, oldest unpaid invoice date, days outstanding, last payment date. Per row: one-tap WhatsApp reminder (reuses statement image) and one-tap "record payment" (reuses `RecordPaymentSheet`).

### Why we need it
The credit ledger records debt but doesn't help recover it. Recovered cash is the most visceral ROI a $12/month product can show an owner, and this anchors the Customer Pack's price.

### How it should act
- Sort options: largest balance / oldest debt / recently reminded last.
- "Reminded" timestamp stored per customer when a WhatsApp reminder is sent (local field, synced).
- Badge on Customers nav item with count of customers overdue beyond an owner-set day threshold (default 30).
- Gated like other financial views (owner-only financials rules apply).

### Acceptance Criteria
- [ ] List shows only customers with balance > 0, with balance, age (days since oldest unpaid credit sale), last payment, last reminder.
- [ ] One-tap reminder opens WhatsApp with the statement image flow; marks "reminded today".
- [ ] One-tap payment recording updates the list immediately.
- [ ] Threshold configurable; badge count correct.
- [ ] Balance/age math consistent with `useCustomerBalance` (single source of truth — reuse it, do not reimplement).
- [ ] Fully offline (reminder send obviously needs connectivity at tap time; graceful message if offline).

### Definition of Done
Reuses existing balance composable (no duplicate math); permission-gated; QA with credit + partial payments + returns in history.

---

## WAFI-105 — Rate-Change Repricing Assistant

**Priority:** Important · **Effort:** ~3–5 days (label printing rides WAFI printer work) · **Depends on:** nothing for the view; printer driver for labels

### Description
After the owner confirms an exchange-rate change, show an impact sheet: % move, and the top-N fastest-moving products with old vs new SYP shelf prices. Actions: share the list as text/image to WhatsApp (staff group), and — once the ESC/POS driver exists — print new shelf labels.

### Why we need it
In an inflation economy the rate change silently reprices the whole shop; today the cashier discovers it customer-by-customer. This turns Sacred Rule #2's widget into a visible "the product just earned its fee" moment, and is a strong live-demo weapon.

### How it should act
- Trigger: after rate save (only when change ≥ owner-configurable %; default 2%).
- List = top 30 by units sold in last 30 days (fallback: highest stock value) with old/new SYP price columns.
- Dismissible; reachable later from the exchange-rate widget ("آخر تغيير").

### Acceptance Criteria
- [ ] Sheet appears after a qualifying rate change with correct old/new SYP prices (whole-number display rules follow existing rate conventions).
- [ ] WhatsApp share produces a readable RTL text or image list.
- [ ] No repricing of past sales; the view is derived-only (prices are USD-stored — verify no writes).
- [ ] Threshold configurable in Settings.

### Definition of Done
Derived-only (read-only feature, no schema change); QA with a >50% rate change (existing confirmation flow must still fire first).

---

## WAFI-106 — Supplier Debt Ledger ("What You Owe")

**Priority:** Important · **Effort:** ~1 week · **Depends on:** nothing (mirrors customer ledger patterns)

### Description
Track payables per supplier: receivings can be marked "on credit"; supplier balance = credit receivings − supplier payments. Record payments (cash USD/SYP, transfer, USDT, hawala — same method set as customer payments). Supplier detail shows balance and history.

### Why we need it
Shops buy on credit from wholesalers; the owner's true position includes what they owe. Also: every supplier balance recorded is supplier-graph data for the year-3 marketplace.

### How it should act
- Receiving form gains "دفع الآن / على الحساب" (paid now / on account) choice.
- New table `supplier_payments` (supplier_id, amount_usd, currency, method, **shift_id, device_id**, paid_at, note, sync_status).
- Supplier list shows balances; totals card "إجمالي ما عليك للموردين".
- Owner-only (financials gating).

### 🔴 INTEGRATION WARNING
- **Double-count risk:** product cost already flows into COGS via receivings. A supplier payment must **never** be recorded as an expense — it is a balance movement only. Enforce in code: supplier payments write no expense row and do not appear in expense reports.
- **Drawer attribution:** a **cash** supplier payment removes physical cash from the drawer → it MUST carry `shift_id` + `device_id` from day one and be netted into the Z-report expected-cash math (new line: "مدفوعات موردين نقداً"). Do not repeat the expenses/customer_payments attribution gap.
- **Cross-currency payments:** debts are tracked in USD; a payment made in SYP converts at the **current app exchange rate at payment time** (NOT any sale's locked rate — rate locks are per-sale and don't apply here), and that conversion rate is stored immutably on the `supplier_payments` row (`exchange_rate_at_payment`) for auditability. Same pattern as `exchange_rate_at_receiving` already on receivings.

### Acceptance Criteria
- [ ] Receiving on-account increases supplier balance; payment decreases it; balance derived, never stored.
- [ ] Cash supplier payment appears in Z-report cash reconciliation for the shift it was made in, per currency.
- [ ] Supplier payments never appear in expenses or reduce profit (profit already carries COGS).
- [ ] Non-cash methods (transfer/USDT/hawala) do not touch drawer math.
- [ ] Migration adds tables with RLS matching existing tenant-scoping pattern; PowerSync schema + sync rules updated.
- [ ] Fully offline.

### Definition of Done
Invariants doc updated (supplier payments = balance-sheet movement); Z-report tests updated; QA: receive on credit → pay cash → close shift → variance correct.

---

## WAFI-107 — Operator Anomaly Flags ("Worth a Look")

**Priority:** Important · **Effort:** ~1 week · **Depends on:** better with WAFI-100 (discount data) but not blocked

### Description
A weekly owner-dashboard card surfacing statistically unusual operator patterns from existing data: returns processed per operator vs shop average, oversold confirmations, shift variance recurrence, (later: discount totals from WAFI-100). Framed strictly as "للمراجعة" (for review) — never as accusation.

### Why we need it
The Z-report catches tonight's missing cash; patterns catch the smarter leaks. This is the feature owners tell other owners about — a referral engine on the product's core anxiety.

### How it should act
- Read-only aggregation over `returns`, `sales`, `cashier_shifts`, `stock_adjustments`, `audit_log`. No new write paths.
- Flag when an operator's weekly metric exceeds shop mean by a threshold (start simple: > 2× average with minimum sample size 5).
- Owner can mark a flag "reviewed" (stored locally-synced, small table or audit entry).
- Owner-only visibility (financials gating).

### Acceptance Criteria
- [ ] Card appears only for owners; shows max 3 flags/week, plain-language Arabic ("خالد أجرى ٩ مرتجعات هذا الأسبوع، متوسط المتجر ٢").
- [ ] No flags fire below minimum sample sizes (no accusing a staffer over 1 return).
- [ ] "Reviewed" dismisses the flag and is audit-logged.
- [ ] Zero writes to operational tables; measurable query cost acceptable on low-end Android (test with 10k sales).

### Definition of Done
Threshold constants in one config file for tuning; copy reviewed for neutral framing; perf check on device.

---

## WAFI-108 — Dead-Stock Report ("Money Sleeping on the Shelf")

**Priority:** Critical (Reporting Pack "aha" feature) · **Effort:** ~3–4 days · **Depends on:** nothing

### Description
A report: products with stock > 0 and no sale in N days (default 90, owner-adjustable 30/60/90/180), showing per product: last sold date, stock qty, cost value tied up; headline = total frozen capital ("لديك ٢٬٣٤٠$ في بضاعة لم تُبع منذ ٩٠ يوماً").

### Why we need it
Frozen inventory capital is a silent tax the paper notebook can never reveal. Actionable surprise is what makes the Reporting Pack feel underpriced. (Full ABC/seasonality analysis stays in v2 — this is the simple 20% that delivers 80%.)

### How it should act
- Lives in `/reports`; gated `can_view_reports` + financials rules.
- Sort by value tied up (default) or by age.
- Row actions: jump to product; (post-WAFI-100) apply a clearance discount.
- Excludes open items and zero-cost quick-adds from the value headline (counted separately as "غير مُسعّرة").

### Acceptance Criteria
- [ ] Last-sold derived from sale_line_items; products never sold use created_at as age basis and are labeled "لم تُبع أبداً".
- [ ] Headline value = Σ(stock × cost) for qualifying products; matches manual spot-check.
- [ ] Threshold selector persists per user.
- [ ] Returns/restocks don't count as "sales" for recency.
- [ ] Performs acceptably at 2,000 products / 50k line items on low-end Android.

### Definition of Done
Read-only; query indexed/measured; QA vs hand-computed fixture.

---

## WAFI-109 — One-Tap Reorder List via WhatsApp

**Priority:** Important · **Effort:** ~3–4 days · **Depends on:** suppliers feature (shipped)

### Description
From low-stock/out-of-stock items, build a reorder list grouped by supplier (product's last-received supplier as default), let the owner adjust quantities, and send per-supplier as a formatted RTL WhatsApp message.

### Why we need it
Turns low-stock alerts from "knowing" into "ordering" in the channel restocking already happens in. Strategically: trains the exact behavior (and captures the supplier-product graph) that the year-3 marketplace converts into orders.

### How it should act
- Entry: from low-stock alerts and from supplier detail.
- Suggested qty default = low_stock_threshold × 2 − current_stock (editable).
- Message format: shop name, date, numbered product lines (name ×qty), plain text (wholesalers read text, not images).
- Sent lists stored (`reorder_lists` table or reuse of a simple log) for "what did I order Tuesday" reference — optional v1 of ticket, in scope if cheap.

### Acceptance Criteria
- [ ] Items grouped by inferred supplier; unassigned items in an "بدون مورد" group with quick supplier assign.
- [ ] Quantities editable before send; empty groups can't send.
- [ ] `wa.me` deep link opens with correctly encoded Arabic RTL text.
- [ ] Works offline up to the send tap.

### Definition of Done
QA Arabic encoding in WhatsApp on Android; supplier inference from most recent receiving line tested.

---

## WAFI-110 — Two-Tier Pricing (Retail / Wholesale Price per Product)

**Priority:** Important · **Effort:** ~1–1.5 weeks · **Depends on:** decide stacking rules with WAFI-100 if both ship

### Description
Add an optional second price per product (`price_wholesale_usd`) and a customer flag/tier (`price_tier: retail|wholesale`). When a tiered customer is attached to the sale, tier price resolves automatically at line-add, with a visible badge on the line ("سعر جملة").

### Why we need it
Many retail shops sell semi-wholesale to repeat business buyers from memory — off-system pricing that corrupts reports. **This ticket also implements the "wholesale-aware schema" architectural lock (price-list assignment on customers) that CLAUDE.md mandates from day one and which is currently unimplemented.**

### How it should act
- Product form: optional wholesale price (must be ≤ retail price; warn if below cost).
- Customer form: tier selector (default retail), owner/manager only.
- Cart: attaching a wholesale customer re-resolves prices for lines already in the cart (with notice); detaching reverts.
- Reports: margin and best-sellers must segment or annotate by tier.

### 🔴 INTEGRATION WARNING
- **Margin math:** profit/margin calcs read one price — line items already store the actual sold price, so reporting is safe, but any report computing "expected margin" from `products.price` must use the tier-aware resolver.
- **Discount stacking (with WAFI-100):** define ONE rule and enforce it: tier price applies first, discounts apply on top, caps evaluated against the tier price. Document in invariants.
- **Rate lock:** tier resolution happens in USD before SYP conversion — no interaction with the locked rate, but verify re-resolution on customer attach uses the sale's locked rate for display.

### Acceptance Criteria
- [ ] Wholesale customer attached → lines show tier badge and tier price; receipt shows final prices (no tier disclosure to end customer beyond price).
- [ ] Mid-sale attach/detach re-resolves with visible notice; totals correct at locked rate.
- [ ] Tier changes are audit-logged (customer tier set/changed, by whom).
- [ ] Migration: nullable product column + customer column; PowerSync schema + sync rules updated; RLS per existing pattern.
- [ ] Sales history and line items show which tier fired.

### Definition of Done
Invariants doc gains the price-resolution order rule; tests for attach/detach re-pricing; QA credit sale at wholesale tier → statement shows net.

---

## WAFI-111 — One-Tap Full Shop Backup ("Your Data Is Yours")

**Priority:** Important (sales-objection killer) · **Effort:** ~2–4 days · **Depends on:** exports feature (shipped)

### Description
One button in Settings → Exports: generate a single dated Excel workbook containing all shop data (products, categories, sales + lines + payments, customers + payments, suppliers + receivings, expenses, shifts, returns), then share via the OS share sheet (WhatsApp-to-self, Drive, etc.). Monthly gentle nudge if no backup in 30 days.

### Why we need it
Kills the strongest anti-cloud sales objection in the Syrian market ("if the internet/you disappear, my data is gone"). Converts the product's scariest attribute into a stated strength.

### How it should act
- Orchestrates existing `useExportFile` per-table exports into one multi-sheet workbook (RTL, existing conventions).
- Large shops: chunk sales sheets by month to keep memory bounded on cheap phones.
- **Owner-gated:** the workbook contains financials → visible only under owner/financials permissions; action audit-logged.
- Nudge: dashboard toast/card, dismissible, once per month max.

### Acceptance Criteria
- [ ] Single .xlsx with one sheet per entity, dated filename `wafi-backup-<shop>-<YYYY-MM-DD>.xlsx`.
- [ ] Completes on a low-end Android with 50k sale lines without OOM (chunking verified).
- [ ] Only owner (or financials-granted) sees the button; backup creation audit-logged.
- [ ] Nudge respects 30-day logic and dismissal.
- [ ] Works fully offline (file generation local; sharing needs whatever the share target needs).

### Definition of Done
Memory profiling on device; permission tests; restore is explicitly OUT of scope (document that in the UI copy honestly: "نسخة للاطلاع والأرشفة").

---

## WAFI-112 — Cash-Flow Calendar (Scheduled In vs Out)

**Priority:** Nice-to-have (Important once WAFI-106 ships) · **Effort:** ~3–5 days · **Depends on:** installments (shipped); supplier dues (WAFI-106) for the "out" side

### Description
A week/month calendar view: expected cash **in** (installment dues from `installment_dues`) and — when WAFI-106 exists — planned **out** (supplier balances, optionally with due dates added to receivings), with a running expected-cash line.

### Why we need it
Answers the owner's forward-looking question ("can I pay the wholesaler Saturday AND restock Monday?") using dates already in the database. Delivers the felt value of the v2 forecast years early, without prediction.

### How it should act
- `/reports` entry; owner/financials gated.
- Overdue dues styled distinctly; tapping a due opens the customer/installment or supplier.
- Clearly labeled as scheduled amounts, not predictions ("مواعيد متوقعة").

### Acceptance Criteria
- [ ] Installment dues appear on due dates with amounts; paid dues drop off.
- [ ] With WAFI-106: supplier dues appear; without it, the "out" lane is hidden (not empty).
- [ ] Running total math verified against fixtures.
- [ ] Fully offline; performant with 500 open dues.

### Definition of Done
Read-only; empty/degraded states designed (no dues at all → helpful copy, not a blank grid).

---

## WAFI-113 — Daily Spot-Check (Micro Cycle Counting)

**Priority:** Important · **Effort:** ~4–6 days · **Depends on:** stock take (shipped)

### Description
Each day, the app selects 3–5 products (weighted toward high value × high movement, with rotation so everything gets covered) and prompts at shift open: "عدّ هذه الأصناف". A slim counting sheet records counts; variance is computed against current expected stock and, on confirm, adjusts stock with an `spot_check` adjustment reason.

### Why we need it
Full stock takes are rare events; shrinkage detection needs cadence. Reuses the stock-take engine at daily frequency, feeds WAFI-107's variance-recurrence signal, and deters theft by making random counts routine.

### How it should act
- Selection: deterministic daily seed per shop (no `Math.random` at runtime — derive from date+shop so offline devices agree), weight = stock_value × recent_sales, exclude items counted in last 14 days.
- Skippable (owner sees skip streaks in WAFI-107 later).
- Uses stock-take snapshot semantics at the moment the sheet opens (expected qty frozen per line).

### 🔴 INTEGRATION WARNING
- **Two variance systems:** a spot-check adjusting stock while a full stock-take session covering that product is OPEN would corrupt that session's snapshot-based variance. Rule: products inside an open stock-take session's scope are **excluded from spot-check selection**, and committing a spot-check is blocked for such products with a clear message.
- **Mid-count sales race:** same discipline as stock take — commit **deltas** (counted − snapshot-expected), not absolute counts, so a sale rung during the count isn't erased.

### Acceptance Criteria
- [ ] Daily selection appears at most once/day, only when a shift is open; skippable.
- [ ] Variance display per line; confirm writes `stock_adjustments` with reason `spot_check` and the delta method.
- [ ] Products in an open stock-take session never selected/committable.
- [ ] A sale made mid-count does not get overwritten (delta commit verified by test).
- [ ] History of spot-checks visible under stock-take history.

### Definition of Done
Delta-commit unit tests incl. concurrent-sale fixture; selection determinism test (same date+shop → same picks); Arabic copy reviewed.

---

## WAFI-114 — QR Code on Receipts (Return Lookup + Authenticity)

**Priority:** Important (rides the printer critical path) · **Effort:** ~2–3 days on top of printer work · **Depends on:** ESC/POS printer driver (WAFI-017 line of work); camera scanning (shipped)

### Description
Print a QR (payload: sale ID + shop short-code) on every receipt. In-app "scan receipt" action opens the exact sale → return sheet pre-loaded. Scanning also verifies authenticity: unknown ID or already-fully-returned sale shows a warning.

### Why we need it
Kills the scroll-through-history friction for returns and closes the fake/reused-receipt refund hole — a known cash-retail fraud pattern. Makes the printed receipt a key back into the system, which no local incumbent does.

### How it should act
- QR rendered via ESC/POS QR command (fallback: skip QR if driver/model lacks support — receipt still prints).
- Scan entry point on Sale History screen and POS overflow menu; uses existing ZXing camera flow.
- Lookup is local-first (synced data), so it works offline for this shop's sales.

### Acceptance Criteria
- [ ] Every printed receipt (incl. reprints, which already carry the duplicate marker) includes a scannable QR.
- [ ] Scanning opens the sale detail with return action in ≤ 2 taps.
- [ ] Fully-returned sale scan → clear "تم إرجاعها بالكامل" warning; unknown ID → "إيصال غير معروف".
- [ ] Works offline end-to-end.
- [ ] Printer models without QR support degrade gracefully.

### Definition of Done
Tested on at least the generic 80mm + one brand printer; QR payload format documented (versioned prefix for future fields).

---

## WAFI-115 — Expiry-Date Tracking (Simple Version)

**Priority:** Nice-to-have (strategic: pharmacy/food door-opener) · **Effort:** ~3–4 days · **Depends on:** receivings (shipped)

### Description
Optional expiry date per receiving line (earliest-expiry stored per product as a simple denormalized field). Report: "تنتهي صلاحيتها قريباً" — products expiring within N days with stock and value; dashboard warning card when value is nonzero.

### Why we need it
Cheapest possible down payment on the v1.5 pharmacy vertical (where expiry is mandatory) while food/cosmetics retail gets value now. Explicitly the simple version — **batch/lot-level inventory and FEFO are OUT of scope** (that's the v1.5 complexity cliff).

### How it should act
- Receiving line form: optional date field.
- Product stores `earliest_expiry` (updated on receiving; cleared manually or on stock-out).
- Report under `/reports` with 30/60/90 day filter.

### Acceptance Criteria
- [ ] Expiry entry optional and fast (date picker defaults sensible, e.g., +6 months).
- [ ] Report lists products by earliest expiry with stock × cost value; headline total.
- [ ] Dashboard card appears only when expiring value > 0.
- [ ] Explicitly no batch tracking: one expiry per product, documented limitation shown in UI copy.
- [ ] Migration + PowerSync schema updated per existing patterns.

### Definition of Done
Scope fence respected (no batch tables); QA receiving→report flow offline.

---

## WAFI-116 — WhatsApp Product Card ("Do You Have X?")

**Priority:** Nice-to-have · **Effort:** ~2–3 days · **Depends on:** messaging + product photos (shipped)

### Description
From any product, tap "share" → rendered card image (photo, name, SYP + USD price, shop name, date) → OS share/WhatsApp. Answers the constant customer WhatsApp question "عندك...؟ بقديش؟" with something professional in seconds.

### Why we need it
First feature that helps the shop sell MORE rather than leak less; makes product photos worth entering; reuses the proven statement-image canvas renderer.

### How it should act
- Renderer: same canvas approach as `renderStatementImage`, RTL, brand-consistent.
- Card stamps "السعر بتاريخ اليوم" + date, since the image outlives rate changes.
- Available to all roles (price sharing is not financial data).

### Acceptance Criteria
- [ ] Card renders correctly with and without a product photo (clean fallback layout).
- [ ] Prices reflect the current rate at render time, date-stamped.
- [ ] Share works via OS share sheet and `wa.me`.
- [ ] Arabic text renders correctly in the image on Android WebView/Chrome.

### Definition of Done
Visual QA on small screens; renderer code shared with statement image (no fork).

---

## WAFI-117 — Practice Mode (Sandboxed Training & Demo Shop)

**Priority:** Important (serves onboarding AND founder demos) · **Effort:** ~1.5–2 weeks (isolation is the work) · **Depends on:** nothing, but read the warning twice

### Description
A toggleable practice state with clearly watermarked UI ("وضع التدريب") and a seeded fake catalog. New staff learn the POS risk-free; owners explore without fear; founder demos run rich and resettable. One-tap reset to seed state.

### Why we need it
The scariest moment for a new user is "what if I ruin my numbers." Practice mode deletes that fear (serves the 30-min self-serve onboarding goal), and solves the demo-data problem for the Syria trip.

### How it should act
- Entered from Settings (owner) or first-run onboarding; exiting returns to the exact prior real state.
- Practice data lives in a **separate local database instance** — not a flag on rows.
- Persistent, unmissable visual treatment: colored banner on every screen + watermark on the (simulated) receipt output.

### 🔴 INTEGRATION WARNING — the highest-risk ticket of the 18
- **Sync isolation:** practice writes must NEVER enter the PowerSync upload queue. A leaked practice sale into a real shop's books is a catastrophic trust failure. Implementation MUST be a second local DB (or fully detached schema instance) with sync disconnected — **never** an `is_practice` column on real tables.
- **Receipt sequences:** practice sales must not claim/burn real receipt numbers (sequence continuity is a real-books guarantee). Practice uses its own visibly fake sequence (e.g., prefix `TEST-`).
- **Audit log:** practice must not write to the real append-only audit log.
- **Shift/drawer:** practice shifts are practice-local; they never appear in real shift history or Z-report data.
- **Export/backup leak:** all export and backup functions (WAFI-111 full backup, existing `/settings/exports`, WAFI-123 import log exports) MUST check practice mode. In practice mode they are either disabled with a clear notice, or every generated file is watermarked "بيانات تدريب — TRAINING DATA ONLY" in the filename AND a cover sheet — a practice "backup" mixed into real business records is the exact trust failure this isolation exists to prevent.

### Acceptance Criteria
- [ ] Toggle in/out preserves the real session, cart drafts, and open shift untouched (byte-identical real DB before/after, verified by test).
- [ ] Zero practice rows ever appear in `ps_crud`/upload queue (asserted by test).
- [ ] Practice receipts show `TEST-` numbering and watermark.
- [ ] Reset restores the seed catalog in ≤ 5 seconds.
- [ ] Banner visible on every screen in practice mode, both themes, RTL.
- [ ] Seed data is realistic (30+ Arabic-named products with photos, a few customers with balances, an open shift).

### Definition of Done
Isolation verified by automated test that diffs real DB and upload queue across a full practice session (sales, returns, shift close); code review specifically signs off the isolation boundary; PR includes invariants-impact note.

---

## Suggested Build Order (within this set)

Quick wins first, respecting dependencies:

1. **WAFI-104** Collections worklist (highest ROI/effort)
2. **WAFI-103** Denomination counting
3. **WAFI-108** Dead-stock report
4. **WAFI-101** Quick-add / open item
5. **WAFI-100** Discounts (biggest invariants surface — schedule with care)
6. **WAFI-102** Park/resume
7. **WAFI-106** Supplier ledger → then **WAFI-112** cash-flow calendar
8. **WAFI-110** Two-tier pricing (after WAFI-100 stacking rule decided)
9. **WAFI-109** Reorder via WhatsApp
10. **WAFI-107** Anomaly flags (richer after 100/113 exist)
11. **WAFI-113** Spot-check
12. **WAFI-114** QR receipts (with printer driver work)
13. **WAFI-105** Repricing assistant (labels ride printer work)
14. **WAFI-111** Backup · **WAFI-115** Expiry · **WAFI-116** Product card
15. **WAFI-117** Practice mode (schedule before the Syria demo trip)

> Reminder: these tickets are *additions*. The evaluation's critical path (printer driver, real auth wiring, drawer `shift_id` unification, device registration) still comes first — several tickets above explicitly assume the drawer fix (WAFI-106) or the printer (WAFI-114, WAFI-105 labels).

---

# EDGE CASE REGISTER (per ticket — treat as additional Acceptance Criteria)

Each item below is a test case the implementing dev must handle and the reviewer must check. Cross-cutting cases first.

## Cross-cutting (apply to EVERY ticket)
- **Offline-created duplicates:** two offline devices doing the same action (creating the same barcode, paying the same supplier) must merge sanely after sync — no crashes, duplicates surfaced for owner review where they can't be auto-merged.
- **Sync-pending data:** every list/report must render correctly when some rows are `sync_status='pending'` — never filter them out of local math (local DB is the source of truth for on-device views).
- **SYP rounding:** all SYP displays follow the existing whole-number convention; derived SYP values must round ONCE at display, never accumulate rounding in stored values (store USD, derive SYP).
- **Deleted/archived references:** any feature referencing a product, customer, supplier, or staff member must handle that entity being deleted/deactivated after the fact (show name snapshot, don't crash, don't orphan money).
- **RTL + long Arabic names:** every new screen tested with 40+ character Arabic product/customer names, both themes, phone width.
- **Empty states:** every new list/report has a designed empty state with next-step copy — not a blank screen.
- **Timestamp drift:** date-dependent logic (debt aging WAFI-104, spot-check selection WAFI-113, dead-stock recency WAFI-108) runs on cheap offline Androids whose clocks drift. Rule: track the offset between device time and server time at each successful sync; when the device clock is > 24h out from last-known server time, flag locally created rows (`device_time_suspect`) and show a "تحقق من ساعة الجهاز" notice. Never block sales on clock sanity — flag, don't stop.

## WAFI-100 Discounts
- 100% discount (free item): allowed only with owner PIN regardless of caps; sale still records COGS (real loss visibility).
- Discount larger than line/sale total: hard-blocked, never negative totals.
- Fixed SYP discount that converts to < $0.01: round per convention, never store negative.
- Line discount + sale discount together: sale discount applies to the already-line-discounted subtotal; document and test the order.
- Split payment of a discounted total: legs must sum to net total exactly (watch rounding across cash SYP + card USD legs).
- Return of a sale-level-discounted sale, line by line across multiple return events: prorated refunds must never sum to more than what was paid (cap check at data layer).
- **Cherry-picking exploit fixture (mandatory test):** cart = $100 item + $10 item, sale-level discount → net paid $55. Customer returns ONLY the $100 item. Refund = (item price ÷ original cart total) × net paid = (100/110) × 55 = **$50** — never the item's list price, never more than remaining net paid, never leaving the residual cart negative. Define proration as line-share-of-net-paid and store the per-line net allocation at sale time so returns don't recompute it differently later.
- Discount applied, then operator switches mid-sale: the discount's audit attribution = the operator who applied it, not who confirmed.
- Role caps changed while a sale is open: cap evaluated at apply-time; already-applied discounts stand.

## WAFI-101 Quick-Add / Open Item
- Same unknown barcode quick-added on two offline devices → two products, same barcode: after sync, barcode lookup must deterministically pick one (oldest) and flag the duplicate in "needs review".
- Quick-add with barcode that matches an *archived* product: offer to reactivate instead of creating a duplicate.
- Open item with price 0: blocked (free giveaways go through WAFI-100's 100% discount path so they're audited).
- Quick-add sheet dismissed mid-sale: cart untouched, scan buffer cleared (no ghost input from the wedge scanner).
- Cost filled in retroactively on a quick-add product: past sales keep their recorded (unknown) cost status — the "uncosted sales" notice only clears for *new* sales; document this or backfill deliberately (pick one, test it).
- Open-item return with restock attempted: restock option must be absent/blocked (no product to restock).

## WAFI-102 Park / Resume
- Product in a parked cart is edited (price change) or archived while parked: resume re-validates every line — archived products dropped with a notice, prices re-resolved per the re-lock rule.
- Stock sold out while parked: resume re-runs the stock guard; short lines flagged, not silently kept.
- Parked cart references a customer who was deleted: customer detached with notice.
- Device crash/reload with parked carts: carts survive (local persistence) and reattach to the still-open shift; if the shift was force-closed remotely, carts are discarded with the shift-close rule.
- Park attempted with an empty cart: no-op, no empty parked entries.
- Maximum parked carts (suggest 10): oldest-warning, not unbounded growth.

## WAFI-103 Denomination Counting
- Tally entered, then user switches to manual total: one wins — switching modes clears the other with a confirm (never store a breakdown that contradicts the stored total; AC: stored breakdown sum === stored total, enforced).
- Denomination list edited by owner mid-shift: open tallies keep the list they started with.
- Zero-count close (empty drawer): valid, breakdown all zeros ≠ missing breakdown.
- Damaged/torn notes ("not countable"): out of scope — but the fallback manual-total path is the documented answer; don't block close.

## WAFI-104 Collections Worklist
- Customer with negative balance (shop owes customer / store credit): excluded from the chase list, shown in a separate "لهم رصيد" section — never "chased".
- Balance exactly 0 from offsetting entries: excluded.
- Customer with no phone number: reminder button disabled with "أضف رقم" affordance, not a broken wa.me link.
- Reminder tapped while offline: graceful message; "reminded" timestamp NOT set (the message never went out).
- Debt age when the oldest unpaid sale was partially paid: age anchors to the oldest sale with any unpaid remainder (FIFO application must be defined in one place — reuse/extend `useCustomerBalance`, add the rule there).

## WAFI-105 Repricing Assistant
- Rate changed twice quickly: sheet reflects the latest rate only; "old" price = price at previous rate, not at first rate of the day.
- Products with wholesale tier (WAFI-110): show both tier prices or retail only — decide (recommend retail only, note in UI).
- Zero sales history (new shop): fallback list = highest stock value; empty catalog → skip sheet entirely.

## WAFI-106 Supplier Ledger
- Overpayment (payment > balance): allowed (advance payment), balance goes negative, displayed as "رصيد لك عند المورد" — but require a confirm.
- Return-to-supplier: OUT OF SCOPE for this ticket — document; balance correction via a manual adjustment entry with note (audit-logged) is the interim path.
- Receiving deleted/edited after payments recorded against the supplier: balance is derived, so it self-corrects — but add a floor test: payments exceeding remaining credit receivings shows the negative-balance state, never an error.
- Cash payment recorded with no open shift (owner pays supplier after hours): allowed but flagged unattributed — or blocked with "افتح وردية" — **decide with product owner; default recommendation: allowed, attributed to no shift, listed separately in Z-report period totals** (do NOT silently attach to the next shift).
- Same-supplier payment entered on two offline devices: both stand (payments are facts, not counters); flag in owner review if within same hour + same amount (likely double entry).

## WAFI-107 Anomaly Flags
- Shops with 1 operator: comparisons vs "shop average" are meaningless → suppress operator-comparative flags entirely; only absolute-pattern flags (e.g., variance recurrence) allowed.
- New staff member's first week: grace period, no flags on < 5 shifts of history.
- Flag about the OWNER's own activity: still shown (owner sees themselves) — never special-cased away silently.
- Week with near-zero sales (holiday): minimum activity floor before any flag fires.

## WAFI-108 Dead Stock
- Product received recently but never sold: age from first receiving, not created_at, when receiving data exists.
- Product with stock > 0 but cost = 0/unknown: listed but excluded from the value headline, counted in the "غير مُسعّرة" note.
- Product sold only via returns-restock (edge): restock is not a sale; recency unaffected — covered, but test it.
- Threshold change mid-view: recompute, don't mix.

## WAFI-109 Reorder via WhatsApp
- Product never received (no supplier inference): lands in "بدون مورد" group — covered; also handle supplier since deactivated.
- Suggested qty formula yields ≤ 0 (threshold met since alert): line pre-filled at 0 and excluded unless edited.
- Message exceeds WhatsApp URL-encoding practical length (~2k chars): split into numbered parts automatically.
- Supplier with no phone: group renders with "أضف رقم المورد" action instead of send.

## WAFI-110 Two-Tier Pricing
- Wholesale price set below cost: warn at save (allowed — loss leaders exist — but audit-logged).
- Wholesale price left empty for some products: tiered customer gets retail price for those lines, badge absent — no error.
- Customer tier changed while they're attached to a parked cart: resume re-resolves (ties into WAFI-102 revalidation).
- Tiered customer on a credit sale then tier removed: historical sales keep their sold prices (line items are the record) — verify no report recomputes from product price.
- Both tier price and discount on one line (if WAFI-100 shipped): stacking rule test fixture mandatory (tier first, discount on top, cap vs tier price).

## WAFI-111 Backup
- Backup while sync has pending uploads: allowed — file reflects local truth; stamp the workbook with "pending sync: N rows" on a cover sheet so the owner knows.
- Backup during an open shift: allowed; shift marked open in the export.
- Interrupted generation (app backgrounded/killed on cheap phone): no partial file shared — generate to temp, share only on completion.
- Shop with zero data (fresh): produces a valid workbook with headers, not a crash.

## WAFI-112 Cash-Flow Calendar
- Overdue dues from months ago: rolled into a single "متأخرات" bucket at the start, not scattered across past dates.
- Partially paid installment due: remaining amount shown, not original.
- Due dates on Fridays/holidays: display-only feature — no adjustment logic; document.

## WAFI-113 Spot-Check
- Selected product sold out (stock 0) before counting: still countable (counting zero IS the point).
- Selected product archived between selection and count: dropped from the sheet silently, replacement not drawn (keep determinism).
- Two devices open the same day's spot-check: same deterministic picks; first commit wins per product, second device sees "already counted today" per line.
- Count entered but app killed before confirm: sheet restores from local draft or resets cleanly — never half-committed adjustments (single transaction).

## WAFI-114 QR Receipts
- QR from a DIFFERENT shop scanned (shop short-code mismatch): "إيصال من متجر آخر" — never leak whether the ID exists.
- Old receipts printed before this feature: no QR → the manual history search path remains; don't remove it.
- Reprinted receipt QR: same sale ID (fine) — return sheet already shows prior returns, duplicate-refund guard is the existing over-return block; add explicit test: scan same QR twice, second return attempt limited to remaining quantities.
- Damaged/partial QR scan: standard scan failure UX, fall back to receipt-number manual entry field (add it to the scan screen).

## WAFI-115 Expiry
- Expiry date in the past entered at receiving: allowed with warning (clearance purchases exist), immediately appears in the report.
- New receiving with LATER expiry while older stock unsold: single-field model keeps the EARLIEST date — known limitation, but must not silently overwrite earlier with later; keep min(existing, new).
- Earliest-expiry product hits stock 0: clear the field on next receiving, or show stale-date caveat; pick one, test it.

## WAFI-116 Product Card
- Product without a price (quick-add pending review): share blocked with "أكمل بيانات المنتج".
- No exchange rate set: SYP line omitted, USD only (never block sharing on rate).
- Very long product name / no photo: fixed-layout fallbacks verified visually.

## WAFI-117 Practice Mode
- App killed mid-practice: on restart, app must KNOW it's in practice mode (persisted flag) — restarting into real mode with practice UI state would be the nightmare scenario; test crash-restart both directions.
- App version upgrade while a practice DB exists: practice DB is disposable — on schema mismatch, silently rebuild from seed (never run real migrations against it, never block app start).
- Practice mode entered while real shift is open with a real cart draft: both untouched on exit (already an AC — add the cart-draft case explicitly).
- Storage pressure on cheap devices: practice DB size capped; reset reclaims space.
- Staff (non-owner) attempting to enter practice mode: allowed by owner setting only (default: owner + manager can enter; cashiers enter only from the onboarding flow).

---

**Review rule:** a PR for any ticket above is incomplete unless its edge-case list items are either covered by a test, handled with a documented UX decision, or explicitly moved out of scope with product-owner sign-off in the PR description.

---
---

# PART B — IMPROVEMENT TICKETS FOR IMPLEMENTED FEATURES (WAFI-118..132)

Source: `docs/PRODUCT_EVALUATION_2026-07-17.md` Part 1 (per-feature audit), Part 3 (critical path), Part 6 (journey friction), Part 7 (interaction analysis). Each ticket improves a feature that already exists in the codebase. Edge cases are inline per ticket.

**Critical path order (from the evaluation):** WAFI-118 → 119 → 120 → 130 → 123. These come before Part A tickets.

---

## WAFI-118 — Real ESC/POS Thermal Printer Driver (Sacred Rule #3)

**Priority:** CRITICAL — the single biggest blocker to demo and adoption · **Effort:** Weeks · **Improves:** `usePrinter.ts` (currently SimulatedDriver only)

### Description
Implement the first real printer driver behind the existing `IPrinterDriver` interface: ESC/POS over WebUSB, targeting the generic Chinese 80mm printer first, then Epson TM-T20 and Star TSP143. Includes: Arabic text rendering (ESC/POS has no native Arabic shaping — render receipt as a raster image via canvas, print as bitmap), cash-drawer kick command, printer selection/pairing UI in Settings, and a test-print action. Publish the first **Tested Hardware list** page as part of this ticket.

### Why we need it
Sacred Rule #3 is currently unmet: zero real printing exists. A Syrian shop will not replace its system with one that cannot hand the customer a paper receipt. Every demo, pilot, and sale is blocked on this ticket.

### How it should act
- Settings → الطابعة: "connect printer" → WebUSB device picker → driver auto-detected by vendor/product ID where possible, manual model select otherwise → test print.
- Sale confirmation prints automatically (owner toggle); reprint from sale history keeps the existing duplicate marker.
- Print failures NEVER block the sale: sale commits first, print is fire-and-forget with a visible retry toast.
- Arabic receipts rendered to bitmap via canvas (reuse statement-image rendering approach) — guarantees correct RTL/shaping on every printer.
- Cash drawer kick on cash sales (ESC p command), owner toggle.
- Z-report gains "print to thermal" alongside existing browser print.

### Acceptance Criteria
- [ ] Full sale receipt (logo, shop info, tax number, lines, totals dual-currency, footer) prints correctly in Arabic on the generic 80mm via WebUSB on Android Chrome.
- [ ] Print failure (unplugged, out of paper) surfaces a toast with retry; the sale is already committed and unaffected.
- [ ] Drawer kick fires on cash tenders when enabled.
- [ ] Printer connection survives app reload (permission persistence per WebUSB rules; re-pair flow is one tap).
- [ ] Test print from Settings works before any sale.
- [ ] `docs/TESTED_HARDWARE.md` (or public page) created with model, connection type, status.
- [ ] iOS/unsupported-browser: printing UI degrades to a clear "unsupported on this browser — use WhatsApp receipt" message, never a silent failure.
**Edge cases:** power loss mid-print (retry reprints full receipt with duplicate marker); paper-out mid-print; two rapid sales queuing prints (serialize, never interleave); printer disconnected between pairing and first sale.

### Definition of Done
Verified on ≥ 2 physical printer models; print path covered by a hardware-simulation test for the encoding layer; POS code contains zero direct hardware calls (driver-file rule from CLAUDE.md honored); Tested Hardware list published.

---

## WAFI-119 — Wire Real Auth: Login/Signup Routes, Retire devAuth

**Priority:** CRITICAL — multi-tenant is unproven until this ships · **Effort:** ~1 week (verification + gaps, wiring largely landed) · **Improves:** `auth.ts`, routed `/login` `/signup` `/forgot-password`, `devAuth.ts`

> **CODE-VERIFIED 2026-07-17:** `/login`, `/signup`, and `/forgot-password` ARE already routed (`router/index.ts:55-56`); only `LandingPage.vue` remains unrouted. `bootstrapDevAuth` is env-gated (`VITE_DEV_AUTO_SIGNIN`, no-op when unset) but WILL run in a production build if the flag is set — with embedded credentials. Ticket scope is therefore: verify the wired flow end-to-end, close the remaining gaps, and make the prod flag impossible to ship accidentally.

### Description
Finish and prove the real-auth rollout: decide/wire `LandingPage.vue` (or delete it), add a build-time guard so `VITE_DEV_AUTO_SIGNIN` cannot be set in production bundles, and run the full multi-tenant verification below. Handle the full lifecycle: signup → shop provisioning (migration 021) → first sync → owner setup → shift gate; sign-out → local data handling; session expiry while offline.

### Why we need it
The auth routes exist, but the multi-tenant story (RLS, sync buckets, per-shop scoping, sign-out data isolation) has never been proven end-to-end for a second real tenant — and the dev auto-sign-in escape hatch can still ship to production via one env flag. This blocks every pilot beyond the brother's shop until verified.

### How it should act
- Unauthenticated → landing/login; authenticated + synced → existing gate flow (setup-owner / lock screen) unchanged.
- Signup uses existing phone→synthetic-email flow with `AuthFailureReason` messages surfaced in Arabic.
- **Offline session persistence is sacred:** an authenticated device that goes offline for days must keep working (POS never blocked by token refresh failure); re-auth is required only after explicit sign-out or server-side revocation.
- Sign-out requires online confirm + warns about pending unsynced ops (count from `ps_crud`); blocked while dead-letter items exist until owner resolves or explicitly abandons them.
- `VITE_DEV_AUTO_SIGNIN` remains for local dev only, excluded from production bundle path.

### Acceptance Criteria
- [ ] Fresh install → signup → shop provisioned → products added → sale completed → visible in Supabase under the new tenant, invisible to other tenants.
- [ ] Second account on the same device after sign-out: no data bleed between shops (local DB cleared/rescoped — verify PowerSync bucket switch).
- [ ] Airplane-mode for 72h: app fully functional, syncs on reconnect.
- [ ] Wrong password / duplicate phone / weak password each show the mapped Arabic message.
- [ ] devAuth code path unreachable in production build (build-time check or test).
**Edge cases:** signup interrupted after auth-user creation but before provisioning completes (retry-safe — migration 021 idempotency verified); session revoked server-side while device offline mid-shift (grace: finish shift locally, block new shift + show re-login); clock-skewed device vs token expiry.

### Definition of Done
End-to-end test with two real tenants on hosted Supabase; sign-out data-isolation test; the single-device provisioning memory-doc flow (customer #0) re-verified post-change.

---

## WAFI-120 — Drawer Unification: `shift_id` + `device_id` on Expenses & Customer Payments

**Priority:** CRITICAL — must land before any second device exists · **Effort:** ~3–5 days · **Improves:** Z-report accuracy (`useZReport.ts` documents this flaw itself)

### Description
Add `shift_id` and `device_id` columns to `expenses` and `customer_payments`; populate them at write time from the session/shift stores; switch Z-report cash math from time-window attribution to direct linkage. Establish the invariant: **anything that touches the drawer carries `shift_id` + `device_id`** (rule already applied to sales, cash_movements, returns; extended by WAFI-106 to supplier payments).

### Why we need it
The Z-report's variance — the product's core anti-theft number — is computed by time window for cash expenses and credit collections. With two devices/overlapping shifts, amounts double-count and variance is wrong. A wrong theft-detection number is worse than none. Cheap now; a data-migration nightmare after pilots accumulate history.

### How it should act
- Migration: nullable columns (historical rows stay null); PowerSync schema + sync rules updated.
- Write paths: expense form and `RecordPaymentSheet` stamp current shift/device when a shift is open.
- Z-report: rows with `shift_id` attribute directly; legacy null rows fall back to the existing time-window logic (clearly scoped to pre-migration data).
- Cash expense/payment recorded with **no open shift**: allowed, `shift_id` null, shown in a separate "خارج الورديات" line in period reports — never silently attached to a shift (same decision pattern as WAFI-106).

### Acceptance Criteria
- [ ] Two overlapping shifts (simulated two devices): each Z-report counts only its own cash expenses/collections; totals across both equal the true sum (no double count, no loss).
- [ ] Legacy rows (null shift_id) still appear in reports via fallback; no historical Z-report snapshot changes (snapshots are persisted — untouched).
- [ ] New writes always stamped when a shift is open; audit spot-check passes.
- [ ] Non-cash customer payments (transfer/USDT/hawala) unaffected by drawer math (existing invariant preserved).
**Edge cases:** shift force-closed while an expense form is open on another screen (stamp validated at save: if that shift is closed, treat as no-open-shift path); pending-sync expense created before migration deployed syncing after (server accepts null).

### Definition of Done
Z-report unit tests for overlap fixture; invariants memory/doc updated; deployed migration verified on hosted Supabase.

---

## WAFI-121 — Stock-Take Commit: CONFIRMED BUG — Absolute Writes Erase Mid-Count Sales

**Priority:** CRITICAL (confirmed by code verification, no longer hypothetical) · **Effort:** ~3–5 days · **Improves:** `useStockTake.ts` commit path

> **CODE-VERIFIED 2026-07-17:** `confirmSession` (`useStockTake.ts:107-126`) calls `adjustStock(productId, line.countedStock)` — an **absolute** `SET current_stock = counted`. The snapshot (`expected_stock`) feeds only the variance *display*, never the write. Any sale rung during the session is erased from stock at commit. Additionally verified: **no double-commit guard** (confirming twice re-runs every adjustment), **multiple sessions can be open simultaneously** (no constraint), and only non-zero-variance lines are committed.

### Description
Fix the commit to apply **deltas**: `adjustment = countedStock − expected_stock (snapshot)`, applied to *live* `current_stock`, so intra-session sales/returns survive. Add a double-commit guard (status check before commit, single transaction), and a one-open-session-per-scope constraint (or explicit multi-session UX decision). Show a "تحرّك أثناء الجرد" disclosure in review for lines where live stock ≠ snapshot.

### Why we need it
Every sale made mid-count is currently erased from stock at commit — corrupting inventory, subsequent COGS, low-stock alerts, and the owner's trust in all stock numbers. Evening counts during trading hours make this a certainty, not a risk. Double-commit doubles the corruption.

### How it should act
- Commit per line: `current_stock = current_stock + (counted − snapshot_expected)`, clamped ≥ 0 with the existing oversold-tag convention; written as `stock_adjustments` reason `stock_take`, one transaction per session.
- `confirmSession` refuses when session status ≠ `in_progress` (idempotent).
- `startSession` blocks (or warns + scopes) when another `in_progress` session overlaps the same products.
- Review screen: lines with live ≠ snapshot show the intra-session movement and the resulting final stock.

### Acceptance Criteria
- [ ] Test: snapshot 10 → sell 2 (live 8) → count 9 → commit → final stock **7** (live 8 + delta −1); the sale is preserved.
- [ ] Test: return-restock during count handled by the same delta math (opposite sign).
- [ ] Double `confirmSession` call: second is a no-op with a clear message.
- [ ] Two overlapping `in_progress` sessions on the same product prevented (or the documented multi-session decision implemented).
- [ ] Zero-variance-with-movement lines: a product counted equal to *snapshot* but sold since (counted 10, snapshot 10, live 8) must still commit delta 0 — i.e., live stays 8, sale preserved; add this exact fixture.
- [ ] Historical committed sessions untouched.
**Edge cases:** product archived mid-session (delta still commits; product stays archived); two review screens open on two devices (status guard makes second commit a no-op after sync); offline device committing after another device already committed the same session (status conflict surfaces in review, not silent double-apply).

### Definition of Done
Delta test suite incl. the fixtures above; status-guard test; migration/constraint decision for concurrent sessions recorded; QA one real session with mid-count sales offline.

---

## WAFI-122 — Server-Side Financial Data Enforcement (formerly WAFI-010)

**Priority:** Important · **Effort:** Weeks (sync-rule surgery — careful) · **Improves:** owner-only financials (currently client-side gating only)

### Description
Enforce financial-data visibility at the sync layer: sessions/devices operating for non-privileged staff must not receive financial rows (cost fields, profit aggregates, expenses, supplier costs) at all. Client-side gating (`permissions.ts`) remains as UX; the server becomes the guarantee.

### Why we need it
Today a cashier with browser dev tools can read every cost, margin, and expense — the data is on-device, only the UI hides it. The owner-only-financials feature already shipped is a promise the architecture doesn't keep. Trust is the product's pitch.

### How it should act
- Design decision first (spike, 1–2 days): per-role sync buckets vs column-level exclusion vs separate financial tables. Constraint: the POS must keep working offline for cashiers (they need prices and stock, NOT costs).
- Likely shape: cashier sessions sync products without `cost`, no expenses, no supplier payment amounts; owner/manager-with-grant sessions sync everything.
- Role change (cashier promoted) triggers re-sync of the newly visible data.

### Acceptance Criteria
- [ ] A cashier session's local DB (inspected directly) contains no cost/expense/profit source data.
- [ ] Cashier POS flows fully functional offline (sell, return, shift close) with the reduced dataset.
- [ ] Z-report for a cashier still shows THEIR shift's cash figures (drawer facts ≠ financials — define the line explicitly in the spike doc).
- [ ] Role/grant change propagates within one sync cycle; revocation removes data on next connect.
- [ ] Existing owner devices unaffected through the migration (no resync data loss).
**Edge cases:** device shared between cashier morning and owner evening (bucket switch on operator change is NOT feasible — sync identity is the account, not the operator; document that per-operator on one shared owner-account device remains client-gated, and the server guarantee applies per signed-in account — align with WAFI-119's account model); COGS in profit trend must not be computable from data a cashier has.

### Definition of Done
Spike ADR written (per PRINCIPLES.md template) before implementation; two-session isolation test on hosted Supabase; rollout plan for existing synced devices.

---

## WAFI-123 — Excel Import Wizard: Ship the Screen

**Priority:** CRITICAL for self-serve onboarding · **Effort:** ~1 week · **Improves:** `src/features/imports/` (composable + types exist; no UI, no route)

### Description
Build the user-facing import flow on top of the existing `useColumnMapping` scaffolding: upload .xlsx/.csv → auto-detect Arabic+English columns → mapping review → validation preview (errors per row) → import products in batches → summary. Route it under Settings and surface it in onboarding.

### Why we need it
Onboarding a shop with 500 existing products by hand kills self-serve and every pilot conversion. The evaluation identified catalog coverage as the weakest link degrading six downstream features. Half the code already exists, unreachable.

### How it should act
- Wizard steps: file → mapping (auto-guess with confidence, user confirms) → preview (valid/invalid rows, inline reasons in Arabic) → import → summary (created / skipped / failed with downloadable error rows).
- Duplicate handling: match by barcode first, then exact name — user chooses per-import policy: skip / update prices / create anyway.
- Price/cost currency selector per import (existing types support it); SYP prices converted at current rate to stored USD with the rate recorded in the import log.
- Runs fully offline; imported rows sync like any writes.

### Acceptance Criteria
- [ ] A messy real-world file (mixed Arabic/English headers, blank rows, text-formatted numbers, 1,000 rows) imports with correct mapping and a truthful summary.
- [ ] Duplicate policy honored; re-running the same file with "skip" creates zero duplicates (idempotent re-import).
- [ ] Invalid rows never partially import (row-atomic); error file downloadable.
- [ ] 2,000-row import completes on low-end Android without freezing the UI (batched writes, progress bar).
- [ ] Reachable from Settings and from the onboarding checklist.
**Edge cases:** file with barcodes colliding with existing products AND within itself; numeric barcodes mangled by Excel scientific notation (detect & repair); prices with Arabic decimal separators/thousands marks; empty file / headers-only; import interrupted mid-batch (resume or clean rollback — pick, test).

### Definition of Done
Fixture files (Arabic headers, English headers, mixed, dirty) in the repo as test assets; import log persisted; onboarding checklist item wired.

---

## WAFI-124 — Payment Fast Path: One-Tap Exact Cash

**Priority:** Important — direct fastest-checkout payoff · **Effort:** ~2–3 days · **Improves:** `PaymentModal.vue` / `usePayment.ts`

### Description
Add prominent one-tap tender buttons for the dominant case: "نقداً ل.س (مضبوط)" and "نقداً $ (مضبوط)" — exact cash, no change — completing the sale in a single tap from the cart. The full modal remains for everything else. Owner setting picks which fast buttons show and their order (shops differ in dominant currency).

### Why we need it
The tender modal sits on every sale's critical path; the audit estimated ~80% of transactions are simple cash. One tap saved per sale × hundreds of sales/day is the cheapest speed win available.

### How it should act
- Fast buttons on the cart/charge area; tap → sale commits through the existing atomic path with a single `sale_payments` leg, zero change.
- Long-press (or small chevron) opens the full modal pre-set to that method for entering a tendered amount (change flow).
- All existing guards unchanged (idempotency, rate lock, stock).

### Acceptance Criteria
- [ ] Cash-exact sale = exactly one tap after cart is ready; confirmation screen unchanged.
- [ ] `sale_payments` rows identical in shape to the modal's cash flow (reports/Z-report see no difference).
- [ ] Buttons configurable in Settings; default = SYP first.
- [ ] Accidental-tap protection: fast button disabled for 300ms after cart changes (debounce against scan-then-tap slips).
**Edge cases:** fast tap racing the idempotency guard (double-tap = one sale — existing guard covers, add test); cart total 0 (blocked); credit-customer attached (fast cash still valid — clears nothing on the ledger, correct by invariants).

### Definition of Done
Tap-count measurement before/after documented in PR; reuses `usePayment` (no forked payment path).

---

## WAFI-125 — Barcode Scanner Robustness (Wedge Configuration)

**Priority:** Important · **Effort:** ~2–3 days · **Improves:** `useBarcodeScan.ts`

### Description
Make wedge detection configurable and observable: terminator (Enter/Tab/none-timeout), inter-key timing threshold, minimum length; plus a Settings diagnostic screen ("scan here — we'll show what we received") for pairing cheap scanners. Unknown-barcode handling itself is WAFI-101.

### Why we need it
Timing-based detection with fixed constants fails on slow/cheap scanners — precisely the hardware Syrian pilots will own. A scanner that half-works poisons the fastest-checkout pitch, and today there's no way to diagnose it in the field (remote support reality: brother on WhatsApp).

### Acceptance Criteria
- [ ] Terminator, timing threshold, min length configurable in Settings with safe defaults (current behavior).
- [ ] Diagnostic screen shows raw captured sequence + timing verdict, sharable as text (for remote support).
- [ ] Scanning while a text input is focused doesn't leak scanner characters into the field (focus guard verified).
- [ ] Two scans back-to-back (< 200ms apart) both register.
**Edge cases:** scanner sending barcode without terminator (timeout finalization path); barcodes shorter than min length (ignored, logged in diagnostics); keyboard user typing fast being misdetected as a scan (threshold test).

### Definition of Done
Tested with ≥ 2 physical scanner models; defaults documented in Tested Hardware list (WAFI-118's page).

---

## WAFI-126 — Credit Balance Visible at Sale Time

**Priority:** Important · **Effort:** ~2–3 days · **Improves:** `CustomerPickerModal.vue` / credit tender flow

### Description
Show each customer's current outstanding balance inline in the customer picker, and a colored warning chip when attaching a customer whose balance exceeds an owner-set soft threshold (default $100) to a **credit** sale. Soft = warn, never block (hard limits are v1.5's credit-limits feature).

### Why we need it
Today the cashier extends credit blind. This is the cheap half of v1.5's credit-limits feature, pulled forward: the ledger data already exists, it's just not shown at the decision moment.

### Acceptance Criteria
- [ ] Picker rows show balance (color-coded: zero/normal/over-threshold); search unaffected in speed.
- [ ] Attaching an over-threshold customer to a credit sale shows a one-line warning with the balance; sale proceeds normally on confirm.
- [ ] Threshold owner-configurable; warning fires only for credit/installment tenders (cash sales to indebted customers are fine — no warning).
- [ ] Balance math reuses `useCustomerBalance` (single source of truth); picker performance acceptable at 500 customers on low-end Android (precompute/cached balances if needed — measure first).
**Edge cases:** negative balance (store credit) shown green as "له رصيد"; balance including pending-sync rows (must include them — local truth); customer picked BEFORE tender chosen then tender switched to credit (warning fires at tender switch too).

### Definition of Done
Perf measurement at 500 customers documented; threshold in Settings; no duplicated balance math.

---

## WAFI-127 — Return Lookup by Receipt Number: Polish the EXISTING Search

**Priority:** Nice-to-have · **Effort:** ~1 day (mostly built) · **Improves:** `useSaleHistory.searchByNumber`

> **CODE-VERIFIED 2026-07-17:** receipt-number search **already exists** — `searchByNumber` does an all-time prefix search on `display_sale_number` (`useSaleHistory.ts:181-200`) and is the primary way to find a sale today. The original ticket premise ("scroll-through-history only") was wrong. Remaining scope is polish, not construction.

### Description
Close the gaps around the existing search: (1) surface it in the *return* context (when a cashier's intent is "return this receipt," the search should be the first thing they see, not the 7-day history list); (2) bare-number entry without the device prefix must disambiguate when two devices share a sequence number; (3) numeric-first keyboard and not-found messaging.

### Acceptance Criteria
- [ ] Search field visible without scrolling on Sale History; placeholder shows the receipt-number format.
- [ ] Bare number matching multiple device prefixes shows all candidates with device + date; exact prefixed entry opens directly.
- [ ] Not-found shows clear guidance (typo / different shop).
- [ ] Numeric keypad input mode on mobile; prefix characters still enterable.
- [ ] Fully-returned sale opens with the existing returned marker; over-return still blocked downstream (existing behavior — regression test only).
**Edge cases:** leading zeros (6-digit zero-pad format — verify prefix search tolerates unpadded entry, e.g. "45" finds "000045"); pending-sync sale findable (local data — verify).

### Definition of Done
Multi-device disambiguation fixture test; unpadded-entry behavior decided and tested.

---

## WAFI-128 — First-Run Exchange Rate: Guided Setup Instead of Hard Stop

**Priority:** Important · **Effort:** ~1–2 days · **Improves:** POS `ExchangeRateNotSetError` dead-end

### Description
When a sale is attempted with no rate set, replace the error with an inline "حدّد سعر الصرف" sheet (the existing editor, opened in-context); on save, the sale continues where it was. Also add rate-setup to onboarding so the state is rare.

### Why we need it
The hard stop lands at the worst possible moment — first sale, customer waiting. The fix is not removing the guard (a sale without a rate is correctly impossible) but making recovery a 10-second in-context action.

### Acceptance Criteria
- [ ] No-rate sale attempt → rate editor sheet in place → save → cart intact, checkout continues.
- [ ] All existing rate safeguards apply (whole numbers, confirmation on big change, audit log).
- [ ] Cart's rate lock engages with the just-set rate.
- [ ] Onboarding includes rate setup step.
**Edge cases:** rate editor dismissed without saving (back to cart, still blocked, guard message persists); permission-limited operator who cannot set rates (message: "اطلب من المدير تحديد السعر" — verify who may set rates and gate accordingly).

### Definition of Done
QA the exact first-sale path on a fresh shop.

---

## WAFI-129 — Shift Open Fast Path: Default Opening Cash from Last Close

**Priority:** Important · **Effort:** ~1–2 days · **Improves:** shift open ceremony (journey friction #1)

### Description
Pre-fill opening cash (USD + SYP) from the previous shift's closing counted amounts on the same device, shown as editable defaults with "من إغلاق الوردية السابقة" caption. One confirm tap when the float is unchanged — the common case.

### Why we need it
The dual-currency opening count is the slowest step of the daily ceremony. When the drawer wasn't touched overnight, retyping yesterday's numbers is pure friction — and mistyping them manufactures false variance for the whole day.

### Acceptance Criteria
- [ ] Defaults = last closed shift's counted closing amounts (per currency, per device); fully editable.
- [ ] Accepting defaults unchanged = one tap; edited values behave exactly as manual entry today.
- [ ] No previous shift (first ever / new device) → current blank behavior.
- [ ] Pairs with WAFI-103: if a closing denomination breakdown exists, offer it as the opening tally starting point.
**Edge cases:** previous shift force-closed without a count (no defaults — blank with caption why); cash drop at close reduced the drawer (defaults use post-drop counted amounts — verify source field); multi-day gap (defaults still offered, caption shows the close date).

### Definition of Done
Shift-open time measured before/after; false-variance regression test (defaults accepted → expected variance math unchanged).

---

## WAFI-130 — Device Management UI (Registration Already Exists)

**Priority:** Important — gates multi-device rollout · **Effort:** ~3–5 days (registration itself is DONE) · **Improves:** `device.store.ts`, `devices` table (migration 037)

> **CODE-VERIFIED 2026-07-17:** device self-registration **already works in production** — `ensureDeviceRegistered()` (`device.store.ts:48-66`) registers a real device row with a generated code; the env constants (`VITE_STUB_DEVICE_ID/CODE`) are a dev/test seam only, not the production path. Receipt numbers are already prefixed per device (`useSaleNumber.ts:5-7`). The original ticket premise ("env-stubbed at runtime") was wrong. Remaining scope: the management surface and deactivation enforcement.

### Description
Build the owner-facing device management screen on top of the existing registration: Settings → الأجهزة lists the shop's devices (label, code/receipt prefix, last seen, temporary flag from migration 037), owner can rename (human labels like "كاشير ١") and deactivate. Deactivation is enforced: a deactivated device cannot open new shifts after its next sync.

### Why we need it
Registration exists but is invisible and unmanageable: no labels, no way to see which devices exist, no way to revoke a lost/retired device. A shop can't safely run two registers until the owner can see and control the device list — and revocation is a security requirement the moment a device leaves the shop.

### How it should act
- Registration is offline-tolerant: identity generated locally first, `devices` row syncs when online.
- Receipt prefix derived from device code (existing namespacing preserved; existing customer-#0 device migrates its stub identity without breaking receipt continuity).
- Deactivated device: blocked from opening new shifts on next sync; local data intact for audit.

### Acceptance Criteria
- [ ] Fresh device → auto-registers with editable label; appears in Settings device list after sync.
- [ ] Existing seeded device (customer #0) migrates: same effective prefix, no receipt-sequence break (explicit migration test).
- [ ] Two devices on one shop: distinct prefixes, distinct Z-report scoping, both visible in the list.
- [ ] Deactivation blocks new shifts on the target device after sync; mid-shift deactivation lets the open shift close first.
**Edge cases:** device registered offline never coming online (row exists locally only — harmless); browser storage cleared (device re-registers as NEW device — old one goes stale in list; document this PWA reality and show "last seen" so owners can prune); same physical device, two accounts (per-account device identity, aligned with WAFI-119 isolation).

### Definition of Done
Customer-#0 migration verified on hosted Supabase before rollout; device list QA on two physical devices.

---

## WAFI-131 — Per-Customer Feature Flag Infrastructure

**Priority:** Important — monetization is blocked without it · **Effort:** ~3–5 days · **Improves:** hardcoded `featureFlags` const

### Description
Replace the compile-time flag const with per-shop flags: a `shop_features` (or JSON column on `shops`) synced to the client; a single `useFeature(key)` composable gates UI/routes; owner-invisible (flags are set by us, server-side, per the Option C pack a shop pays for). Map existing shipped features to packs (Staff/Customer/Reporting) per the evaluation's pack-coherence table.

### Why we need it
Option C modular pricing is the locked business model, and a week-1 architecture decision — but nothing can be switched per customer today. Without this, every customer gets everything and pack pricing is unenforceable.

### How it should act
- Flags read from the synced shop row; offline devices honor last-synced flags (graceful: features never yank mid-shift — flag changes apply at next app start or shift boundary).
- Default for existing pilot shops: all-on (grandfathering explicit, not accidental).
- Gating points: routes (`isRouteAllowed` extension), nav items, and entry buttons — data keeps syncing regardless (turning a pack off hides UI, never deletes data).

### Acceptance Criteria
- [ ] Toggling a flag server-side changes app capability after refresh/sync without redeploy.
- [ ] Feature-off state shows a clean "هذه الميزة ضمن باقة..." teaser (upgrade path), not a broken screen.
- [ ] Offline device keeps last-known flags indefinitely.
- [ ] Existing shops mapped all-on in the migration; flag keys documented in one registry file.
- [ ] Client tampering (flipping local flags) is bounded: acknowledge client-side enforcement limits; revenue-critical enforcement rides WAFI-122's server-side model where applicable.
**Edge cases:** flag turned off while the gated screen is open (finish current operation, gate on next navigation); conflicting flag rows after offline period (server value wins on sync); brand-new flag key unknown to an old app version (default closed for new features, ignore unknown keys).

### Definition of Done
Flag registry file with pack mapping committed; one existing feature (e.g., `/reports`) actually gated as proof; ADR for the chosen mechanism (simple Postgres column vs table — per CLAUDE.md week-1 decision #3).

---

## WAFI-132 — Dead Code & Orphan Cleanup

**Priority:** Nice-to-have (hygiene, do alongside other work) · **Effort:** ~1–2 days · **Improves:** codebase honesty

### Description
Three items from the audit: (1) wire the onboarding checklist (`/onboarding`) into nav/first-run or delete it; (2) remove the deprecated free-text `products.category` field from forms and (after backfill verification) schema, now that categories tables exist; (3) delete or ticket-reference any other unreachable scaffolding found (imports folder is covered by WAFI-123 — do not delete it).

### Acceptance Criteria
- [ ] `/onboarding` either reachable from first-run + settings, or removed (decision recorded).
- [ ] No form writes to free-text `category`; existing values backfilled/mapped to category_id where possible, remainder logged.
- [ ] Bundle contains no routes/components unreachable by any user path (quick audit script or manual checklist in PR).
**Edge cases:** synced old clients still writing free-text category during rollout (column stays in schema one release longer; removal is a two-step deprecation).

### Definition of Done
Two-step deprecation plan for the column documented; no functional regressions (smoke QA of products + onboarding paths).

---

## WAFI-133 — Categories Management: Bulk Reassign, Nav Entry & Merge

**Priority:** Nice-to-have (Important once catalogs grow past ~200 products) · **Effort:** ~3–4 days · **Improves:** `CategoriesManagementScreen.vue` / `useCategories.ts`

### Description
The categories screen (إدارة الفئات) is solidly built — duplicate guard, protected "غير مصنف" fallback (renameable, never deletable), deletes blocked with a product count when products are attached. Three improvements: (1) **bulk reassignment** — deleting a category with products offers "move N products to [picker]" instead of today's dead-end message sending the owner to reclassify product-by-product; (2) **navigation entry** — the screen is routed (`/categories`) but absent from sidebar/nav, reachable only indirectly; surface it under Products or Settings; (3) **merge** — creating a near-duplicate ("موبايلات" vs "جوالات") is inevitable with quick-add during sales; a merge action (pick source → pick target → products + subcategories move, source deleted) is the cleanup path.

### Why we need it
Categories feed the product grid, stock-take scoping, category breakdown reports, and (future) vertical starter templates. As Excel import (WAFI-123) and quick-add (WAFI-101) accelerate catalog growth, category mess accumulates fast — and today's only cleanup path is product-by-product reassignment, which nobody will do at 300 products. The delete dead-end is the exact "feature requires calling the customer" smell rule #9 warns about.

### How it should act
- Delete-with-products → sheet: "نقل N منتج إلى:" category picker (incl. "غير مصنف") → reassign in one transaction → delete proceeds. Same for subcategories.
- Merge action per category row (overflow menu): pick target → confirm with counts → products' `category_id`/`subcategory_id` updated in one transaction, subcategories moved (name-colliding subcategories auto-merged), source deleted, audit-logged.
- Nav: entry point under Products screen (owner/manager only — `can_manage_products`).
- Keep the "غير مصنف" sanctity rule: never deletable, never a merge *source*, always a valid merge/reassign *target*.

### Acceptance Criteria
- [ ] Deleting a category with products completes via inline bulk reassignment; zero products left orphaned (verify `category_id` integrity after).
- [ ] Merge moves all products + subcategories, handles subcategory name collisions, audit-logs source/target/count.
- [ ] "غير مصنف" remains protected in all paths (delete, merge-source).
- [ ] Screen reachable from Products for `can_manage_products` roles; hidden otherwise.
- [ ] Category breakdown report and stock-take category scoping reflect reassignments immediately (derived queries — verify, don't assume).
- [ ] Fully offline; reassignment is one local transaction.
**Edge cases:** two offline devices creating the same-named category → duplicate guard is local-only, so post-sync duplicates can exist: surface them in this screen with a one-tap merge suggestion; merge target deleted on another device mid-operation (transaction fails clean, message, no partial move); category referenced by an OPEN stock-take session (block merge/delete of categories scoping an open session — same guard family as WAFI-113); rename to an existing name (duplicate guard must also fire on rename, not just create — verify current behavior, add if missing).

### Definition of Done
Transaction test for bulk reassign + merge incl. collision fixture; post-sync duplicate-detection listed; nav entry QA on phone; "غير مصنف" protection covered by tests.

---

## WAFI-134 — DEFECT: Stock-Take Category Scoping Filters on a Dead Column

**Priority:** CRITICAL defect (feature silently broken) · **Effort:** ~2–3 days · **Improves:** `useStockTake.ts` session scoping

> **CODE-VERIFIED 2026-07-17:** `startSession` scopes by the **deprecated free-text `products.category` column** (`useStockTake.ts:21` — `AND category = ?`), which `schema.ts:10` marks as *"no longer written to."* The scope input is free text (`StockTakeStartScreen.vue`), not a category picker. Consequence: scoping a stock take by any category assigned through the new categories system matches **zero products** — category-scoped counting is effectively broken for all newly categorized inventory.

### Description
Rewire stock-take scoping to the real categories system: scope selector becomes a category (and optional subcategory) picker over the `categories`/`subcategories` tables; session filter uses `category_id`/`subcategory_id`. Keep "all products" as the default scope. Store the scope on the session for history display.

### Acceptance Criteria
- [ ] Start screen offers: all products / pick category / pick subcategory (picker, not free text).
- [ ] Session lines = products matching `category_id` (+ subcategory when chosen); verified against a fixture where free-text `category` is empty.
- [ ] Products with no category land in the "غير مصنف" scope and are countable via "all products" (and via the fallback category if assigned).
- [ ] Session history shows the human-readable scope name (snapshotted — a later category rename doesn't rewrite history).
- [ ] No remaining read of free-text `products.category` in the stock-take feature (feeds WAFI-132's column removal).
**Edge cases:** category deleted/merged (WAFI-133) while a session scoped to it is open — block the merge/delete (guard already specified in WAFI-133) AND handle the pre-existing-data case gracefully (session keeps its snapshotted lines regardless); legacy sessions that stored free-text scope display as-is.

### Definition of Done
Fixture test proving new-category scoping matches products; WAFI-132's deprecation checklist updated (one fewer reader of the dead column).

---

## WAFI-135 — DEFECT: Dead-Letter Retry/Discard Not Permission-Gated

**Priority:** Important (data-loss control available to any cashier) · **Effort:** ~1–2 days · **Improves:** `useSync.ts` / `SyncIndicator.vue`

> **CODE-VERIFIED 2026-07-17:** `retryBlocked`/`discardBlocked` (`useSync.ts:38-45`) have no role check, and `SyncIndicator.vue` (rendered in the shared `AppHeader`) exposes them to every operator. The code comments say "the owner resolves each one" — but nothing enforces it. **Discarding a dead-letter item permanently drops a server-rejected operation (possibly a sale) — that's a data-loss decision currently available to any cashier.**

### Description
Gate dead-letter actions by role: cashiers see the blocked count and a "بحاجة لمراجعة المالك" notice only; retry is owner/manager; **discard is owner-only** and requires a confirm that shows exactly what will be dropped (op type, table, human summary, timestamps) plus an audit log entry (`sync.dead_letter_discarded`).

### Acceptance Criteria
- [ ] Cashier session: sees blocked count, cannot retry or discard (UI absent, and the action functions themselves check role — not just hidden buttons).
- [ ] Manager: retry allowed, discard not.
- [ ] Owner discard: confirm sheet renders a readable summary of the dropped op; audit-logged with op identifiers.
- [ ] Retry remains available offline-safe (no-op with message when offline).
**Edge cases:** operator switch mid-view (gating re-evaluates on active operator change); multiple dead-letter items discarded in sequence (one audit entry each); the audit entry itself must never contain secrets/tokens from the op payload (summarize, don't dump).

### Definition of Done
Role-gating tests at the composable level; audit event added to the event registry; UX copy reviewed (neutral, non-alarming Arabic).

---

## VERIFICATION ADDENDUM — Code-Check Results (2026-07-17)

Every ticket's premises were verified against source by three independent code-reading passes. Corrections are already folded into the ticket texts above (marked **CODE-VERIFIED**). Summary for reviewers:

**Tickets whose premise CHANGED (already rewritten above):**
- **WAFI-119** — `/login`, `/signup`, `/forgot-password` already routed; scope narrowed to verification + landing decision + prod-flag guard.
- **WAFI-121** — race **confirmed real** (absolute writes), plus no double-commit guard and concurrent sessions allowed; upgraded to CRITICAL.
- **WAFI-127** — receipt-number search already exists (`searchByNumber`); scope narrowed to polish.
- **WAFI-130** — device self-registration already works; scope narrowed to management UI + deactivation enforcement.
- **NEW WAFI-134** — stock-take category scoping reads the dead free-text column (broken feature).
- **NEW WAFI-135** — dead-letter discard un-gated (data-loss control exposed to all roles).

**Tickets CONFIRMED as written (facts checked):**
- **WAFI-100** discounts: zero discount capability exists; `sale_line_items` has no discount column. *One addition:* an existing `scalePricesToTotal` path scales prices **up** for the overpay case (`PaymentModal.vue:196-199`) — the discount design must define precedence/coexistence with it. Good news: `unit_cost_usd` is snapshotted per line at sale time, so historical margin math is safe under any pricing change.
- **WAFI-101** quick-add: unknown barcode currently shows an error toast `'الباركود غير معروف'` (`POSSaleScreen.vue:96-103`) — the ticket replaces that toast with the quick-add sheet.
- **WAFI-102** park/resume: drafts are strictly one-per-device (`id = device_id`), auto-saved (200ms debounce), cleared on sale completion / leaving POS / 24h purge — **not** at shift close. Park = a new multi-draft store; the shift-close discard rule is new behavior. Note: `draft.db.ts:18` has a dead `selected_payment_method` field — reuse or remove it in this ticket.
- **WAFI-103** denominations: `cashier_shifts` field list confirmed; no breakdown field exists.
- **WAFI-104** collections: no reminder timestamp exists anywhere (statement/reminder composables are pure, no DB writes) — the ticket adds it. `useCustomerBalance` exposes balance + open invoices (newest-first) but **no aging/FIFO** — the debt-age rule must be added there (ticket already requires this; now confirmed as new work, oldest invoice with `remainingUsd > 0`).
- **WAFI-106** supplier ledger: no `supplier_payments` table, no balance, and receivings have **no paid-vs-on-account field** — the ticket's receiving payment-status choice requires a new column on `stock_receivings` (add to migration scope).
- **WAFI-110** two-tier: no wholesale/tier/price-list/unit-conversion fields anywhere — the wholesale-aware schema lock is confirmed unimplemented.
- **WAFI-111** backup: exports today = sales, expenses, products, customers, one dataset at a time — the all-in-one workbook must also ADD the missing datasets (shifts, returns, receivings, suppliers, cash movements) to be a true backup; scope updated accordingly.
- **WAFI-115** expiry: no expiry/due-date fields on receivings or line items — confirmed new columns.
- **WAFI-118** printer: `IPrinterDriver` = a single `print(receipt)` method with default-parameter injection, no driver registry — the registry/selection mechanism is part of the ticket, and `ReceiptData` may need extending (QR field for WAFI-114, raster payload).
- **WAFI-124** fast path: confirmed none exists; modal always opens at method selection, cash always requires keypad entry, no last-method memory.
- **WAFI-125** scanner: constants hardcoded (33ms interval, min length 4, Enter/Tab); **no focus guard at all** — the global listener leaks the first character of every scan (and entire slow scans) into focused inputs. The focus-guard AC is not hardening, it's a bug fix.
- **WAFI-126** balance at sale: picker shows name/phone only; no balance anywhere at pick/tender time; no credit-limit concept in code.
- **WAFI-128** rate setup: current behavior is a dismissible toast pointing at the header rate widget (line-add still throws) — the in-context editor sheet replaces the toast, not a blocking screen.
- **WAFI-129** shift-open defaults: last close is displayed as a read-only hint (`LockScreen.vue:284-289`) but NOT bound into the inputs — the ticket binds it as editable defaults; closing amounts confirmed stored per currency.
- **WAFI-131** flags: `featureFlags` = exactly one env-driven boolean (`electronicsPro`); installments and everything else ungated — premise confirmed.
- **WAFI-132** cleanup: `/onboarding` routed with NO permission guard and unreachable from any nav (confirmed orphan); audit log append-only is enforced at DB level (trigger + revoke) — solid.
- **WAFI-133** categories: duplicate guard fires on rename too (confirmed, remove that edge-case doubt); **"غير مصنف" is never auto-created** — it's only looked up, so a shop without that exact row has no protected fallback: add "ensure fallback exists" (create-on-first-need) to this ticket's scope.
- **WAFI-113/117** (spot-check, practice mode): receipt sequence claim confirmed safe (a failed sale does NOT burn a number — `incrementSequence` runs only after the write transaction succeeds), which validates the practice-mode `TEST-` prefix requirement and the spot-check transaction rules. WAFI-113 now explicitly **depends on WAFI-121 + WAFI-134 landing first** (don't build cadence counting on a broken commit path).

---

## Combined Priority View (Parts A + B)

**Do first — entry tickets & data integrity (Part B):**
1. WAFI-118 printer · 2. WAFI-121 stock-take commit bug (CONFIRMED — small, do immediately) · 3. WAFI-134 stock-take scoping defect · 4. WAFI-119 auth verification · 5. WAFI-120 drawer unification · 6. WAFI-135 dead-letter gating (small) · 7. WAFI-123 Excel import · 8. WAFI-130 device management UI · 9. WAFI-131 feature flags

**Quick wins interleaved (Part A + B, days each):**
WAFI-104 collections · WAFI-103 denominations · WAFI-108 dead stock · WAFI-101 quick-add · WAFI-124 cash fast path · WAFI-128 rate guided setup · WAFI-129 shift-open defaults · WAFI-126 credit balance at sale

**Then:** WAFI-100 discounts → WAFI-110 two-tier · WAFI-106 supplier ledger → WAFI-112 calendar · WAFI-122 server enforcement (spike first) · remainder per Part A order · WAFI-117 practice mode before the Syria trip.
