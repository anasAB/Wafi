# Wafi — Senior Product Strategist Evaluation

**Date:** 2026-07-17
**Spec source:** the built product (code-level inventory of this repo), plus a clearly-separated evaluation of planned/roadmap features (Part 8).
**Philosophy under test:** fastest checkout — every feature is judged by whether it gets a Syrian cashier from "customer at counter" to "receipt in hand" faster and with fewer errors.

---

## PART 1: EXISTING FEATURE AUDIT

### 1. POS Sale Flow (cart, product grid, confirmation)

- **User Outcome:** Ring up a sale on a phone, offline, in Arabic, in seconds.
- **The Good:** Single `writeTransaction` for sale + payments + line items + stock + adjustment means checkout is one atomic local write — no network round-trip on the critical path. Rate-locking at first cart line eliminates the classic dual-currency error where the rate changes mid-sale and totals silently drift. Oversell is blocked at add-time, not at commit, so the cashier finds out before promising goods.
- **The Bad / Missing:** Sale is blocked entirely if no exchange rate is set — a new device or a cleared rate hard-stops checkout at the worst moment. No "quick sale / generic item" path: if a product isn't in the catalog, checkout stalls into product-creation. The stock guard (block at add-time, clamp + `oversold:N` tag at confirm) means behavior differs between the two moments — cashiers will not understand why some oversells pass.
- **Severity:** High — the core loop is solid but has two hard-stop scenarios (no rate, uncataloged item).
- **Concrete Suggestion:** Add an "open item" line type (name + price typed at counter) so no sale is ever blocked by catalog gaps.
- **Success Metric:** Median time from first item added to sale confirmed; % of abandoned carts.
- **Technical Constraint:** Fully offline-capable; receipt sequence namespacing per device is handled.
- **Engineering Risk:** Low — open-item is additive to the existing line model.
- **Effort:** Days.
- **Priority:** Critical — it's the product; the open-item gap is the one real hole in the checkout promise.

### 2. Payments (cash USD/SYP, card, credit, installment, split)

- **User Outcome:** Take money the way Syrian shops actually take it — mixed currencies, mixed tenders, deferred payment.
- **The Good:** Change computed in native currency, SYP entered as SYP — matches how cashiers think; the single biggest error-reducer in a dual-currency market. Double-confirm idempotency guard (WAFI-003) and sequence-persisted-after-write (WAFI-004) show the failure modes were thought through. Credit sales correctly write no tender row, keeping drawer math honest.
- **The Bad / Missing:** Split + installments + credit in one modal is a lot of surface for a cashier under pressure; no evidence of a visually dominant "just cash, one tap" fast path. Unknown: whether the modal defaults to the most common tender.
- **Severity:** Medium — correct but potentially slow; tender selection is on every sale's critical path.
- **Concrete Suggestion:** One-tap "exact cash SYP / exact cash USD" buttons that skip the modal for the ~80% case.
- **Success Metric:** Median taps from "charge" to "confirmed" per tender type.
- **Technical Constraint:** None new — same atomic write.
- **Engineering Risk:** Low. **Effort:** Days. **Priority:** Important.

### 3. Barcode Scanning (USB wedge + camera via ZXing)

- **User Outcome:** Scan instead of search — the fastest possible item entry.
- **The Good:** Supporting both keyboard-wedge (Sacred Rule #3) and lazy-loaded camera scanning means the $12/month customer with no scanner still gets scan speed from their phone.
- **The Bad / Missing:** Timing-based wedge detection is fragile with cheap scanners that emit slowly or lack Enter terminators — no configurable terminator/threshold found. Unknown: behavior on unknown barcode — if it fails silently, that's a checkout stall.
- **Severity:** Medium — the failure mode of a scan miss lands mid-checkout.
- **Concrete Suggestion:** On unknown barcode, open a pre-filled "quick add product" sheet (barcode captured, type name + price, sell immediately).
- **Success Metric:** % of sale lines added via scan vs manual search; unknown-barcode rate.
- **Technical Constraint:** Camera scanning fully offline.
- **Engineering Risk:** Low. **Effort:** Days. **Priority:** Important.

### 4. Receipt Printing — SimulatedDriver only

- **User Outcome:** None yet. `IPrinterDriver` exists; the only implementation logs to console.
- **The Good:** The abstraction layer exists per the week-1 architecture decision, so real drivers slot in without touching POS code. WhatsApp receipt partially substitutes.
- **The Bad / Missing:** This fails **Sacred Rule #3 outright**. A demo that can't print on an Epson TM-T20 loses the room; Syrian shops treat the printed receipt as the proof-of-sale artifact. No ESC/POS, no WebUSB/Bluetooth code anywhere.
- **Severity:** **Critical** — an entry-ticket rule is unmet.
- **Concrete Suggestion:** Ship one real ESC/POS driver (WebUSB, generic Chinese 80mm first) before any other feature work.
- **Success Metric:** % of sales producing a physical receipt; supported-printer count on the Tested Hardware list.
- **Technical Constraint:** Printing is local, so offline is a non-issue; the issue is PWA hardware access (WebUSB requires Chrome/Edge, no iOS Safari — constrains the "any device" demo; must be documented).
- **Engineering Risk:** High — PWA↔thermal-printer is the flakiest integration in this stack.
- **Effort:** Weeks — ESC/POS encoding is days; per-model quirks and Android Chrome WebUSB testing is the long tail.
- **Priority:** **Critical** — the single biggest blocker, ahead of everything else in this report.

### 5. Shifts + Z-Report + Cash Reconciliation

- **User Outcome:** "Are my employees stealing?" — answered per shift with expected-vs-actual variance in both currencies.
- **The Good:** The Z-report composes everything correctly: per-currency cash, card, credit, expenses, refunds, collections, pay-ins/outs, per-operator breakdown, mandatory close note above 5% variance, persisted snapshot. Zombie-shift guard and force-close with evidence show real operational maturity. Genuinely better than Al-Ameen/Noor.
- **The Bad / Missing:** The code documents its own flaw: `expenses` and `customer_payments` carry no `shift_id`/`device_id`, so multi-device shops attribute them by time window — variance can double-count across overlapping shifts. That corrupts the exact number this feature exists to produce. Z-report prints via `window.print` — acceptable for now.
- **Severity:** High — the first two-device pilot silently gets wrong variance; a wrong theft-detection number is worse than none.
- **Concrete Suggestion:** Add `shift_id` to expenses and customer_payments now — before any second device exists in the wild.
- **Success Metric:** % of shifts closed with variance ≤ threshold; % requiring force-close.
- **Technical Constraint:** Time-window attribution breaks under sync lag; shift_id linkage is sync-safe.
- **Engineering Risk:** Low. **Effort:** Days. **Priority:** Critical — cheap now, a data-migration nightmare after pilots have history.

### 6. Customer Credit Ledger + Installments

- **User Outcome:** Track "what customers owe you" — non-negotiable for Syrian retail; balance is derived (credit sales − payments − returned goods − store-credit), so it can't drift.
- **The Good:** Payment methods `cash|transfer|usdt|hawala` mirror Syrian collection reality; only cash hits the drawer. Installment plans with generated due schedules plus WhatsApp reminders is a differentiator no local incumbent has.
- **The Bad / Missing:** Installments shipped before printing did — scope creep vs the litmus test. No sale-time warning when a customer's balance is already high — the cashier extends credit blind. Derived balances recompute over full history; unknown at what volume this gets slow on cheap Android.
- **Severity:** Medium — functionally strong; the sale-time blind spot is the real gap.
- **Concrete Suggestion:** Show current balance inline in the customer picker during a credit sale, soft warning above an owner-set threshold.
- **Success Metric:** DSO trend per shop; % of credit sales to customers over threshold.
- **Technical Constraint:** Derived balance is offline-correct by construction; watch query cost.
- **Engineering Risk:** Low. **Effort:** Days. **Priority:** Important.

### 7. Returns / Refunds

- **User Outcome:** Reverse a sale partially or fully without corrupting stock, drawer, or credit balances.
- **The Good:** Over-return blocked at UI and data layer; refunds flow into Z-report cash math via `shift_id`; credit-sale returns reduce balance through the returns table (no fake negative payments). Configurable return reasons.
- **The Bad / Missing:** Reachable only from Sale History — a customer at the counter with a receipt requires the cashier to find the sale by scrolling. No receipt-number lookup found. A checkout-lane friction point.
- **Severity:** Medium.
- **Concrete Suggestion:** "Find sale by receipt number" input at the top of history (later: scan, once receipts carry a barcode).
- **Success Metric:** Median time from opening history to completed return.
- **Engineering Risk:** Low. **Effort:** Days. **Priority:** Nice-to-have until pilot volume proves return frequency.

### 8. Offline Sync (PowerSync, dead-letter, sync UI)

- **User Outcome:** Sacred Rule #1 — sell with the internet off, and *know* the state of your data.
- **The Good:** The strongest engineering in the product. Dead-letter quarantine for server-rejected ops — with owner-facing retry/discard and Arabic banners distinguishing "server refused" from "no network" — is a maturity level most POS startups never reach. 24h staleness detection feeds the demo moment directly.
- **The Bad / Missing:** Dead-letter puts a data-integrity decision ("discard this sale?") in a shop owner's hands with no support channel behind it. Runtime auth is dev auto-sign-in — the entire sync/tenant story is only proven for one hardcoded account.
- **Severity:** Low as built for single-tenant; High the day a second real customer exists.
- **Concrete Suggestion:** Wire the existing Login/Signup pages into the router and retire `bootstrapDevAuth` — the code exists; everything multi-tenant is fiction until it's done.
- **Success Metric:** % of ops reaching server within 24h; dead-letter rate per 1,000 ops.
- **Engineering Risk:** Medium for auth wiring. **Effort:** Weeks (matches the existing Real Auth plan). **Priority:** Critical — second only to printing.

### 9. Exchange Rate Handling

- **User Outcome:** Sacred Rule #2 — SYP rate as a prominent, safe, fast action.
- **The Good:** Whole-number rates, >50%-change confirmation, audit logging, per-sale rate locking together close off the most damaging fat-finger scenario (a 15,000-vs-1,500 typo repricing a day of sales).
- **The Bad / Missing:** Manual-only is correct for v1. History capped at 5 entries is cosmetic (rate is stored per sale).
- **Severity:** Low. **Concrete Suggestion:** None — leave it alone; resist adding the rate API early (offline conflict, see Part 8).
- **Success Metric:** Rate updates per shop per week.
- **Priority:** Complete.

### 10. Dashboard + Profit Reports

- **User Outcome:** "Am I making money?" on the home screen, with `/reports` drill-down.
- **The Good:** Profit formula (revenue − returns − COGS + restock reversal − expenses) is consistent with the payment invariants; losses shown negative rather than hidden. Anomaly surfacing and staleness bar keep trust in offline data.
- **The Bad / Missing:** The dashboard is the owner's screen but the app boots into a shift-gated flow; unclear whether an owner checking their phone at home hits the PIN/shift wall. Report gating is client-side only; a cashier with dev tools sees financials (acknowledged WAFI-010 gap).
- **Severity:** Medium — client-side-only gating undermines the owner-only-financials work already shipped.
- **Concrete Suggestion:** Prioritize WAFI-010 server-side enforcement at sync-bucket level (don't sync financial rows to non-privileged sessions).
- **Success Metric:** Owner DAU on dashboard; % of owners opening profit report weekly.
- **Engineering Risk:** Medium — sync-rule changes risk breaking replication. **Effort:** Weeks. **Priority:** Important — trust is the sales pitch against paper notebooks.

### 11. WhatsApp Features (receipt, statement image, digest, reminders)

- **User Outcome:** Receipts, statements, and a daily owner digest through the channel every Syrian customer already uses.
- **The Good:** Rendering the customer statement as a canvas *image* is quietly excellent — survives forwarding, needs no PDF viewer, looks professional on any phone. The `wa.me` deep-link approach costs $0 and needs no API approval — right-sized for the budget.
- **The Bad / Missing:** Everything is manual-tap; the "daily digest" is a once-a-day prompt, not a push. Honest, but the roadmap label overstates what's built. Deep links require WhatsApp on the *selling device* — a shared shop tablet may not have the owner's WhatsApp.
- **Severity:** Low. **Priority:** Nice-to-have refinements only; automation is a v2 backend decision.
- **Success Metric:** % of sales where the WhatsApp receipt link is tapped; statement sends per credit customer per month.

### 12. Stock Take

- **User Outcome:** Count the shelf, see variance in units and value, commit corrections — the anti-shrinkage complement to the Z-report.
- **The Good:** Snapshotting expected stock at session start is the correct design (sales during counting don't corrupt variance); category scoping makes a 2,000-SKU shop tractable in evening sessions.
- **The Bad / Missing:** **Unknown:** whether sales during an open session reconcile against the snapshot at commit. If commit blindly writes counted absolutes, every sale made mid-count is erased from stock.
- **Severity:** Medium pending verification; Critical if the race exists.
- **Concrete Suggestion:** Verify; if needed, commit *deltas* (counted − snapshot) rather than absolutes.
- **Success Metric:** Next stock-take variance trending down per shop.
- **Engineering Risk:** Medium. **Effort:** Days to verify/fix. **Priority:** Important.

### 13. Weak features named directly

- **Excel import** — types and column mapping exist with no screen and no route. Dead code in the bundle. **Recommend: finish before first external pilot** — onboarding 500 products by hand kills self-serve.
- **Onboarding progress checklist** — routed but not in nav, orphaned. Wire or remove.
- **Free-text `products.category`** — deprecated but retained alongside the new categories tables; remove before data accumulates in both.

---

## PART 2: CONTRADICTIONS & CONFLICTS

1. **"Fastest checkout" vs shift-gated everything.** Staff → PIN → opening cash → shift open before the first sale of the day. *Resolution:* keep the gate (accountability is the moat vs paper), but optimize shift-open to under 20 seconds; default opening cash to yesterday's closing float.
2. **"Runs on whatever device you have" vs WebUSB printing.** The viable PWA thermal-print path excludes iOS Safari. *Resolution:* Sacred Rule #3 wins — scope "any device" to Android/Chrome for the printing station; phones are scan-and-dashboard devices.
3. **Feature breadth vs the litmus test.** Installments, stock take, categories, cash movements shipped while printing, real auth, and Excel import — all demo/v1 entry tickets — did not. Build order has drifted from the strategy document's own priorities.

## PART 3: FEATURE DEPENDENCIES & SEQUENCING

- **Critical path to a demo-able, pilot-able product:** Real ESC/POS driver → wire Login/Signup into router (kill devAuth) → real device registration (Sub-project 3; `devices` table exists) → `shift_id` on expenses/payments → Excel import screen. Everything else is polish.
- **Blockers:** Printing blocks the demo script itself. Auth wiring blocks any customer beyond the brother. Device registration blocks the second device, which blocks the Z-report attribution fix mattering.
- **Parallelizable:** Excel import UI, return-lookup-by-receipt, payment fast-path — none touch the auth/print/device chain.

## PART 4: COMPETITIVE GAP ANALYSIS

1. **Receipt printing** (universal in mature POS). Critical for market entry — every incumbent prints. Currently absent.
2. **Held/parked sales.** Nearly universal: customer forgets wallet, cashier parks the cart, serves the next person. The Dexie draft-cart layer suggests partial groundwork. Important, not critical.
3. **Price/discount adjustment at line or sale level.** Mature POS universally supports it — and Syrian retail *runs* on haggling. Not found in the sale flow. If a cashier can't knock 5% off, the sale happens outside the system and every report becomes fiction. **Critical for market entry** — and with owner-set discount caps + audit logging it becomes an *advantage*: incumbents allow discounts but don't surface discount abuse to the owner.

## PART 5: HIGHEST-IMPACT NEW FEATURES

1. **Line/sale discount with owner-set caps and audit trail.** Haggled sales stay in-system; report integrity = the retention story; discount-abuse reporting differentiates. Complexity: Medium (cart math, Z-report, audit). Metric: % of sales with discount; off-system sale rate.
2. **Unknown-barcode → instant quick-add-and-sell sheet.** Scan-miss becomes a 10-second recovery; the catalog builds itself during real trading; kills the biggest self-serve onboarding barrier. Complexity: Low. Metric: quick-adds per shop-week; unknown-scan abandonment.
3. **Park/resume sale.** Multi-customer counters don't lose the queue; throughput at exactly the peak moments that decide trust. Complexity: Low-Medium (drafts layer partially exists). Metric: parked sales resumed vs abandoned.

## PART 6: USER JOURNEY & FRICTION POINTS

**Open shop:** boot → 8s sync-wait ceiling → lock screen → pick staff → PIN → enter opening cash in two currencies → shift opens. Friction: dual-currency opening count is the slowest step; defaulting from prior close would halve it. Forgotten PIN at 8am with lockout is a shop-can't-open scenario — recovery codes exist, but does the cashier know where they are?

**Make sale:** scan/search → cart → charge → tender modal → confirm → (no printed receipt) → optional WhatsApp. Friction: tender modal every sale; no-rate hard stop; unknown-barcode dead-end; **the missing printer forces "let me WhatsApp it to you" at every transaction** — the highest-frequency friction in the product.

**Handle returns:** navigate to history → visually find the sale → return sheet. Friction: sale lookup; the return sheet itself is well-guarded.

**Close shift:** cash movements netted → Z-report → count drawer in two currencies → variance → note if >5% → browser print. Friction: dual-currency blind count is inherent; the flow around it is good. Abandonment risk: a cashier facing a large variance at 9pm may simply not close — the zombie-shift guard is the right backstop.

**Cognitive load:** cashier must hold: current SYP rate, customer's paying currency, tender type, and (for credit) customer identity. Rate-lock and native-currency change entry offload the two hardest. Good.

---

## PART 7: FEATURE INTERACTION & VALUE CHAIN ANALYSIS

Features are not valuable alone; they are valuable as loops. This section evaluates the product as a *system*.

### 7.1 The core value loops and their weakest links

**Loop A — Inventory truth:** scan → sale → stock decrement → low-stock alert → receiving → cost update → profit report → stock take verification.
Weakest link: **catalog coverage**. With no import UI and no quick-add-on-scan-miss, products missing from the catalog silently degrade *six* downstream features: stock is wrong, COGS is wrong, profit is wrong, low-stock alerts don't fire, stock-take variance is noise, best-sellers mislead. The import gap is not one feature gap — it is a multiplier on every inventory-adjacent feature. This is the single highest-leverage fix per engineering-day in the product.

**Loop B — Cash truth:** rate lock → native-currency tender → drawer-only cash rules → cash movements → expenses → credit collections → Z-report variance → audit log.
Weakest link: **fragmented drawer plumbing** (see 7.3) plus the **discount gap** — a haggled sale rung "outside" or fudged breaks the loop at its first link.

**Loop C — Trust cascade (the thing the owner pays for):** dashboard + Z-report + stock take + audit log together answer "am I making money / is anyone stealing."
Weakest link: **off-system sales**. No discount capability → haggled sales bypass the system → revenue understated → profit report wrong → owner stops trusting the dashboard → the Reporting Pack ($5/mo) becomes unsellable and the retention story collapses. The discount gap is priced as a reporting-revenue gap, not a checkout-convenience gap.

**Loop D — Credit relationship:** credit sale → balance ledger → WhatsApp statement → payment recording → Z-report collection → installment schedule → reminder.
This loop is the most *complete* in the product and is a genuine differentiator. Its weak link is the sale-time blind spot (no balance shown when extending credit), which is cheap to fix.

### 7.2 Loop-completeness scorecard

| Loop | Completeness | Broken/weak link | Fix cost |
|---|---|---|---|
| Cash truth | ~85% | discounts absent; drawer plumbing fragmented | Days–weeks |
| Credit relationship | ~90% | no balance at sale time | Days |
| Inventory truth | ~60% | catalog coverage (import + quick-add) | Days–week |
| Trust cascade | ~70% | off-system sales; client-only financial gating | Weeks |
| Receipt-to-customer | ~30% | no printer; WhatsApp-only | Weeks |

### 7.3 Redundancy defect: three features, one drawer

Cash movements (shift-linked), expenses (`paid_in_cash`, **not** shift-linked), and customer payments (cash method, **not** shift-linked) are three separate write paths into one conceptual cash drawer with inconsistent plumbing. The Z-report must reassemble them by time window, which is where the multi-device double-counting risk lives. **Recommendation:** unify on a single rule — *anything that touches the drawer carries `shift_id` and `device_id`* — one migration, three write paths, done before device #2 exists.

### 7.4 Pack coherence: built value vs Option C pricing

| Shipped feature | Pack it should sell | Status |
|---|---|---|
| Shifts, Z-report, PIN, roles, audit log, cash movements | Staff Pack (+$5) | Built, mapped ✔ |
| Credit ledger, payments, statements via WhatsApp | Customer Pack (+$5) | Built, mapped ✔ |
| Profit report, dashboard drill-downs, digest | Reporting Pack (+$5) | Built, mapped ✔ (server-side gating pending) |
| **Installments** | *Unpriced* — not in any pack | Built, unmonetized |
| **Stock take** | *Unpriced* | Built, unmonetized |
| **Suppliers/receivings** | *Unpriced* (roadmap says "simplified supplier" in v1 core) | Built |
| Electronics Pro (IMEI/repair/warranty) | +$8 pack | Flag exists, zero code |

Two decisions needed: (a) fold installments into Customer Pack and stock take into Core or Staff Pack — deliberately, not by accident; (b) the **per-customer feature-flag infrastructure** (a week-1 locked decision) does not exist — only a hardcoded `featureFlags` const. Modular pricing cannot be sold without it. This is a silent blocker to revenue, not just to features.

### 7.5 The accountability spine

The shift gate, PIN identity, audit log, and `staff_id` on sales form one spine that every money-touching feature hangs off. This is well-designed and is the structural reason the Z-report can promise per-operator attribution. The spine's two holes are the non-shift-linked drawer writes (7.3) and client-only enforcement (WAFI-010). Fix those two and the anti-theft story is airtight — which *is* the product's sales pitch against both paper and Noor.

---

## PART 8: PLANNED-FEATURE EVALUATION (roadmap, not built — evaluated as plans)

Judged by the litmus test ("would a Syrian shop owner pay $25/month for this alone?"), interaction with existing loops, and effort.

### 8.1 v1 remainder (committed, unbuilt)

| Planned feature | Verdict | Reasoning |
|---|---|---|
| **Excel import wizard** | **Build now, promote to critical path** | Weakest link of the inventory loop (7.1); scaffolding exists; blocks self-serve onboarding. |
| **Public Tested Hardware list** | Build with printer work | Near-zero cost once drivers exist; it's a sales artifact, not a feature. |
| **Self-serve onboarding (30 min)** | Keep, but it's a *composite* | It is not a feature — it's the emergent result of auth wiring + import + quick-add + templates. Track it as an outcome metric. |
| Receipt template editor | Defer to late v1 | Basic receipt settings (logo/tax/footer) already exist; a full editor fails the litmus test alone. |
| Owner Dashboard mobile app (separate, read-only) | **Cut as a separate app** | The dashboard is already a responsive PWA route. Ship an "owner mode" (skip shift gate for owners on non-POS routes) instead — days, not weeks, and no second codebase. |
| Payment confirmation link via WhatsApp | Defer | Marginal on top of the statement image; manual `wa.me` flow already covers the moment. |
| Daily WhatsApp digest (automated) | Keep manual for v1 | Automation requires a backend send path (API costs, approval); the manual prompt delivers 80% of the value at 0% of the cost. |
| Repair tickets / warranty / repair profitability (Electronics Pro) | **Defer until a paying electronics pilot demands it** | +$8/mo pack revenue vs weeks of work for one confirmed user (the brother, who is customer #0, not revenue). Fails the litmus test *today*; passes it the day two electronics shops commit. Do not build speculatively. |
| Photo-first expense capture | Mostly done | Expense photo exists; verify the flow is "photo-first" (camera as the primary CTA) rather than photo-optional. Days. |
| Returns, split payments, staff permissions, supplier receiving, tax number, statements | Done | Already shipped (Part 1). |

### 8.2 v1.5 (evaluated for slotting, with pull-forward/cut recommendations)

| Planned feature | Verdict | Reasoning |
|---|---|---|
| **Credit limits + AR aging** | **Pull forward into v1** | Completes Loop D cheaply; the sale-time balance warning (Part 1 §6) is half of it. Days of work, direct anti-bad-debt value. |
| **Barcode label printing** | **Pull forward, bundle with printer work** | Undervalued at v1.5: shops whose goods have *no* barcodes cannot use scanning at all — the fastest-checkout philosophy is dead on arrival for them. Shares the ESC/POS driver investment. This turns the printer work into two features. |
| Warehouse module (multi-location) | Keep at v1.5, **hard-blocked** | Blocked by device registration + drawer/shift plumbing (7.3). Building it earlier multiplies the attribution bug. Pack revenue (+$8) justifies the slot. |
| Margin report per customer/product | Keep at v1.5 | Data already exists (COGS per line); cheap; Reporting Pack depth. |
| Vertical starter templates | Keep at v1.5, cheap | Pure data + onboarding lever; strengthens self-serve and the "fits any retail shop" demo moment. |
| Composite items/bundles | Keep at v1.5 | Real need (electronics bundles, gift sets); medium complexity through cart, stock, COGS. |
| Live exchange rate API | **Question the premise** | Conflicts with offline-first (a stale "live" rate is worse than a deliberate manual one) and with the audit story (who set the rate?). Manual with confirmation is arguably the *better* product for Syria. Recommend downgrade to "optional reference display," not an auto-setter. |
| Customer Display app | **Cut or push to v2** | Fails the litmus test; second surface to maintain; trust value is real but niche (high-value electronics only). |
| Cashier commission tracking | Defer until asked | No pilot signal yet; adds payroll-adjacent complexity. |
| Loyalty/points | Keep at v1.5 tail | Retention lever, but only after there are customers to retain. |
| Custom report builder | **Push to v2** | The roadmap's own caveat ("after 7 fixed reports") is right; report builders are effort sinks. Ship fixed reports; let pilot requests define the 8th. |
| Expense approval workflow | **Cut** | A 1-3 person shop has no approval chain. This is a big-company feature that wandered in. |
| Supplier price comparison | Defer | Needs multi-supplier data density that won't exist until receiving is habitual across pilots. |
| Recurring invoices | Defer, niche | Rental/subscription shops are a corner case; revisit on demand. |

### 8.3 v2/v3 (light pass — direction, not commitments)

- **B2B marketplace (v2 v0, v3 launch):** The moat depends on the supplier graph being captured *now*. The good news: suppliers/receivings already capture structured supplier + line-item data. Keep receiving friction low — every receiving recorded today is marketplace inventory data in year 3.
- **Wholesale-aware schema (a "day one" lock):** **Not implemented.** No unit-conversion fields on items, no price-list assignment on customers were found in the schema. This is a stated week-1 architectural lock that has quietly not happened. It costs little *now* (columns + types); it costs months in year 3. Flag for a deliberate decision: implement in the next schema-touching migration or consciously release the lock.
- **Tamper-evident audit log (cryptographic chaining):** Good v2 fit; the append-only migration (018) is the right precursor.
- **Photo OCR for expenses, AI assistant, forecasting, e-invoicing, public API:** Correctly sequenced at v2+; none interact with current loops in a way that demands earlier work — *except* that expense photos should keep original resolution stored so OCR works retroactively.
- **Wholesale POS (v3-4):** No evaluation possible or needed now beyond the schema lock above.

### 8.4 Revised build order (synthesis of Parts 3, 7, 8)

1. ESC/POS printer driver (+ Tested Hardware list, + barcode label printing groundwork) — Sacred Rule #3
2. Real auth wiring (kill devAuth) — multi-tenant reality
3. Drawer unification: `shift_id`/`device_id` on expenses + customer_payments — before device #2
4. Discounts with caps + audit — protects the trust cascade
5. Excel import screen + unknown-barcode quick-add — inventory-loop weakest link
6. Device registration (Sub-project 3)
7. Per-customer feature-flag infrastructure — unblocks selling packs at all
8. Credit limits + sale-time balance warning (pulled from v1.5)
9. Owner mode (replaces separate Owner Dashboard app)
10. Everything else per roadmap

---

## EXECUTIVE SUMMARY

**Top 3 Strengths**
1. Offline-first execution is genuinely excellent — atomic sale writes, dead-letter quarantine with owner-facing recovery, honest sync UI. Sacred Rule #1 is met, better than most funded competitors manage.
2. Cash-integrity chain (rate locking, native-currency change, per-currency Z-report reconciliation, drawer-only cash rules, derived credit balances) forms a coherent, accounting-correct core that directly answers "are my employees stealing."
3. Arabic-first, WhatsApp-native, Syrian-payment-method-native (USDT/hawala) — the localization isn't a translation layer, it's the product's grain.

**Top 3 Risks**
1. **Sacred Rule #3 unmet** — zero real printer support; the demo's own hardware moment cannot be performed.
2. **Multi-tenant is untested fiction** — runtime auth is dev auto-sign-in for one account; login/signup pages exist unrouted; per-customer feature flags (the monetization mechanism) don't exist.
3. **Silent data-integrity landmines ahead of device #2** — time-window shift attribution, stubbed device identity, possible stock-take commit race, and the unimplemented wholesale-aware schema lock.

**Biggest Blocker to Adoption:** No thermal receipt printing — a Syrian shop will not replace its current system with one that cannot hand the customer a paper receipt.

**One Feature I'd Build Next:** ESC/POS WebUSB driver for the generic Chinese 80mm printer — it unblocks the demo, Sacred Rule #3, barcode label printing, and the entire sales motion.

**One Feature I'd Remove:** Expense approval workflow (from the v1.5 plan) and the orphaned Excel-import scaffolding as it stands — promote the import to a real screen or delete it; and cut the separate Owner Dashboard app in favor of an owner mode.

**Overall Product Maturity Score: 6/10** — the hard invisible problems (offline sync, cash correctness, dual currency) are solved to a high standard, but two entry-ticket Sacred Rules' worth of visible surface (printing, real sign-in) remain unbuilt, the monetization infrastructure (feature flags) doesn't exist, and build order has drifted toward depth features ahead of entry tickets.

---

## ASSUMPTIONS

Facts come from a code-level inventory of this repo; the following are assumptions or unverified items:

1. **Assumed** haggling/discounting matters at checkout in Syrian retail (market inference; no discount feature exists to observe).
2. **Unknown/assumed** stock-take commit may race with mid-count sales — snapshotting at start is confirmed; commit-time reconciliation is not.
3. **Assumed** the tender modal appears on every sale with no fast path — modal defaults not verified line-by-line.
4. **Assumed** pilot shops will own generic Chinese 80mm printers first (from the project's own hardware budget notes).
5. **Assumed** derived credit-balance computation could slow on cheap Android at scale — no performance data.
6. **Assumed** the wholesale-aware schema fields (unit conversions, price-list assignment) are absent — based on the schema inventory not surfacing them; verify before acting.
7. **Observed facts relied on heavily:** SimulatedDriver-only printing; unrouted login/signup with devAuth bootstrap; missing `shift_id` on expenses/customer_payments (documented in code comments); stubbed device store; unwired import feature; client-side-only permission gating; hardcoded `featureFlags` const; installments and stock take absent from the Option C pricing table.
