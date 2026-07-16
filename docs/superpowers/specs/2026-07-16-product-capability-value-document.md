# Product Capability & Value Document
**Prepared for:** Product Owners & Data Analysts
**Date:** 2026-07-16
**Scope:** All product epics and features reviewed to date — Epics 1–8 (Core/Staff/Customer/Reporting packs), Premium Profit & Expense Reports, Installment Plans, Guided Stock-Take, plus the trust/accountability and platform features layered on afterward (auth, roles, cash management, messaging, exports). Implemented and not-yet-implemented items are both included and clearly marked.

---

## 1. Executive Summary (The "Full Picture")

We are building a cloud-based, offline-first retail operations platform for shop owners and cashiers across Syria and the broader MENA region — replacing paper ledgers, Excel logs, and 2010-era desktop software with a phone-first PWA that speaks the owner's language: "am I making money," "what's in stock," "is someone stealing from me." The core value proposition is trust and control: a shop can ring sales, track inventory, extend credit and installment plans, manage staff and cash accountability, and see real profit — all in Arabic, in dual currency (USD/SYP), on whatever device they already own, whether or not the internet is working. The product has grown from a single-shop POS (Epic 1) into a full operating system for the shop: inventory (Epic 2), a daily health dashboard (Epic 3), customer credit (Epic 4), staff/shift accountability (Epic 5), receiving/suppliers (Epic 8), and a growing set of premium reporting, messaging, and trust features that convert this from "software the owner tolerates" into "software the owner depends on."

---

## 2. Feature Inventory & Value Matrix

### Core Foundation Epics (Core Pack, $12/mo)

---

#### Feature: Ring a Sale & Print Receipt (Epic 1)
**Status:** ✅ Implemented
**The "Job to be Done":** As a cashier, I need to sell products quickly on a phone, in Arabic, take cash in either currency, and give the customer proof of purchase — even when the WiFi is down — so the shop never stops running.
**The Solution:** A phone-first POS screen with product search/barcode scan, a running sale panel, USD/SYP cash or card payment capture, and thermal receipt printing, fully functional offline with background sync.
**User/Business Value:** Replaces paper receipts and manual logs entirely; the 30-second-per-sale target and full offline capability mean the register never goes down — the hard prerequisite for any owner to trust the product with their livelihood.
**📊 Data Analyst Lens:**
- Track: `sale_completed` — Properties: `total_usd`, `total_syp`, `exchange_rate_at_sale`, `payment_method`, `line_item_count`, `sync_status`
- Track: `sale_duration_seconds`, `receipt_print_attempted`/`failed` (Property: `is_reprint`), `barcode_scan_used` (usb/camera vs. manual)
- Track: `offline_sale_count` vs `online_sale_count`, `sync_latency_seconds` on reconnect
- Track: `display_sale_number_collision_flagged` (should be ~0)

---

#### Feature: Exchange Rate Management (Epic 1 / Epic 6)
**Status:** ✅ Implemented
**The "Job to be Done":** As an owner, I need to update today's USD/SYP rate in seconds and trust a sale in progress won't silently reprice.
**The Solution:** A one-tap rate editor on home/POS header; each sale locks its rate at first line item; full rollback-capable history in Settings.
**User/Business Value:** Protects margin in a hyperinflation market; prevents the "I quoted one price and it changed mid-payment" trust break.
**📊 Data Analyst Lens:**
- Track: `exchange_rate_changed` (`old_rate`, `new_rate`, `percent_change`, `changed_by_role`), `exchange_rate_rollback_used`
- KPI: rate-change frequency per shop per day (local currency volatility proxy)

---

#### Feature: Manage Products & Track Stock (Epic 2)
**Status:** ✅ Implemented
**The "Job to be Done":** As an owner, I need my inventory system to be the real system of record — added by me, decremented automatically on sale, alerting me before I run out — so I stop using spreadsheets.
**The Solution:** Manual product CRUD, barcode scan (USB + camera), a guided Excel import wizard with auto column-detection and currency inference, automatic stock deduction on sale, and low-stock alerts on the home screen.
**User/Business Value:** The Excel import wizard is the single biggest onboarding-speed feature in the product — it's the difference between a shop owner spending hours vs. minutes getting live. Automatic deduction means the stock number is finally trustworthy.
**📊 Data Analyst Lens:**
- Track: `product_created` (manual vs. `product_imported`), `excel_import_completed` (Properties: `row_count`, `success_count`, `error_count`, `duration_seconds`)
- Track: `barcode_scan_to_product_match_rate`, `stock_deduction_negative_flagged` (a product oversold past zero)
- Track: `low_stock_alert_shown`, `low_stock_marked_reordered`
- KPI: % of catalog with a cost price populated — directly gates Profit Report accuracy (see the missing-cost warning below)

---

#### Feature: Business Health Home Screen (Epic 3)
**Status:** ✅ Implemented
**The "Job to be Done":** As an owner, I need to know in 3 seconds whether I'm making money today, this week, or this month — without doing math myself.
**The Solution:** Three headline cards (money in / expenses / profit) with a Today/Week/Month toggle, drill-down to line-level detail, a 30-second expense-logging flow, top-5 sellers, and a cash-in-drawer indicator — all working offline with staleness indication.
**User/Business Value:** This is the daily reason to open the app — the single screen most responsible for habitual daily use, which is the leading indicator of retention.
**📊 Data Analyst Lens:**
- Track: `home_screen_viewed` (Property: `period`), `home_card_drilldown` (Property: `card_type`)
- Track: `expense_logged` (Properties: `amount_usd`, `category`, `has_photo`, `duration_seconds`)
- Track: `missing_cost_warning_shown` (Property: `missing_cost_count`) — leading indicator of catalog data-quality debt silently understating profit
- KPI: daily-active-owner rate = % of shops with ≥1 `home_screen_viewed` per calendar day — the core habit-formation metric

---

#### Feature: Customer Credit Ledger (Epic 4, Customer Pack +$5/mo)
**Status:** ✅ Implemented
**The "Job to be Done":** As an owner, every Syrian shop runs on informal credit — I need a real running balance per customer instead of a paper notebook, plus an easy way to remind them via WhatsApp.
**The Solution:** Customer CRUD, "on account" and split-payment methods at checkout, running balances with color-coded status, payment recording across multiple methods (cash/bank wire/USDT/hawala), and one-tap PDF statement generation sent via WhatsApp.
**User/Business Value:** This is a genuine lock-in feature — once a shop's credit customer data lives here instead of on paper, going back is not realistic. It's also the direct dependency for Installment Plans.
**📊 Data Analyst Lens:**
- Track: `customer_created`, `sale_on_account_completed`, `split_payment_completed` (Property: `method_count`)
- Track: `customer_payment_recorded` (Properties: `method`, `overpayment_flag`), `statement_sent_whatsapp`
- KPI: aggregate outstanding-credit total per shop (feeds the home-screen "customers owe you" card) — a receivables-risk proxy
- KPI: statement-send → payment-received conversion rate within 7 days

---

#### Feature: Cashier Shifts & Identity (Epic 5, Staff Pack +$5/mo)
**Status:** ✅ Implemented (core) — several remediation gaps (WAFI-059 through WAFI-065) closed post-launch; see Trust & Accountability section below for status detail
**The "Job to be Done":** As an owner with employees, I need to know who rang every sale, catch cash discrepancies at shift close, and see a tamper-proof history of sensitive changes — so I can leave the shop and trust what happens while I'm gone.
**The Solution:** Employee CRUD with hardcoded Owner/Manager/Cashier roles, 4-digit PIN sign-in, shift open/close with dual-currency cash counts and automatic variance calculation, printed Z-reports, and an append-only audit log covering all sensitive actions.
**User/Business Value:** This is the feature that makes the product sellable to any shop with employees (the majority of reference customers beyond the founder's own shop) — it's the direct answer to "is someone stealing from me."
**📊 Data Analyst Lens:**
- Track: `shift_opened`/`closed` (Properties: `opening_cash_usd`, `opening_cash_syp`, `variance_usd`, `variance_syp`, `variance_pct`)
- Track: `pin_lockout_triggered`, `shift_force_closed_by_owner`, `audit_log_entry_created` (Property: `action_type`)
- KPI: **variance rate** (% of shifts closing with |variance| > 5%) per shop, per cashier — the headline metric the Staff Pack is sold on
- KPI: zombie-shift rate (shifts left open >24h) — a data-integrity/process-adoption signal, addressed by WAFI-065 below

---

#### Feature: Suppliers & Stock Receiving (Epic 8, Core Pack)
**Status:** ✅ Implemented
**The "Job to be Done":** As an owner, stock only ever goes down automatically (on sale) — I need deliveries from suppliers to itemize, increase stock, and refresh cost prices, with a photo of the invoice as proof.
**The Solution:** Supplier records, itemized stock receivings (existing products or create-on-the-fly), per-line cost capture with an opt-in toggle to update the product's standing cost, and an invoice photo attached to each receiving. Receivings are immutable once saved.
**User/Business Value:** Closes the inventory loop opened by Epic 2 — the stock number and the cost basis feeding the Profit Report are now trustworthy end-to-end, not just on the sales side. The invoice photo replaces the paper shoebox of supplier receipts.
**📊 Data Analyst Lens:**
- Track: `stock_receiving_created` (Properties: `supplier_id`, `line_count`, `total_cost_usd`, `has_invoice_photo`)
- Track: `receiving_line_cost_updated` (whether a delivery's cost was pushed into the product's standing cost) — a leading indicator of how current the catalog's cost basis is
- KPI: % of receivings with an attached invoice photo — proxy for how fully suppliers/receiving replace the "paper shoebox"

---

### Premium & Recently-Added Features

---

#### Feature: Premium Profit & Expense Reports (Reporting Pack, +$5/mo)
**Status:** ✅ Implemented (v1.0 — headline, breakdown, trend chart, Profitability/Expenses tabs, period-over-period delta, anomaly banners)
**The "Job to be Done":** As an owner, I need a deliberate answer to "did I make money this week/month/quarter, and is it trending up or down" — not just a today snapshot.
**The Solution:** A dedicated Reports screen with a flexible period picker (week/month/quarter/custom range), a plain-language profit verdict, a green/red trend chart, and a breakdown reusing the same verified profit engine as the home dashboard.
**User/Business Value:** The single feature most directly tied to the "$25/month" litmus test — turns raw transaction data into a business answer and justifies the Reporting Pack's premium price point.
**📊 Data Analyst Lens:**
- Track: `reports_screen_viewed` (Property: `period_type`), `reports_period_changed`, `reports_chart_drilldown_used`
- KPI: % of active shops with ≥1 `reports_screen_viewed`/week — Reporting Pack retention proxy
- **Critical instrumentation flag:** every profit figure must be tagged `data_source: live | imported` — imported-history profit without per-sale cost/rate is fiction and must never blend into a live trend line undetected.

---

#### Feature: Installment / Layaway Plans (التقسيط) (Customer Pack, no new SKU)
**Status:** ✅ Implemented (design approved, build complete per spec)
**The "Job to be Done":** As an owner in electronics/appliance retail, I need to sell on a structured installment plan — down payment + fixed schedule — and know exactly who owes what and when.
**The Solution:** A new "Installment" payment method that captures down payment/term/frequency, auto-generates a due schedule, and surfaces a dashboard card plus one-tap WhatsApp reminders.
**User/Business Value:** Installments are a cultural staple of MENA retail; formalizing them turns a paper-based liability into a trackable, lock-in asset.
**📊 Data Analyst Lens:**
- Track: `installment_plan_created` (`total_amount_usd`, `down_payment_usd`, `term_count`, `term_frequency`, `down_payment_is_zero`)
- Track: `installment_due_paid` (`days_late`, `overpayment_rolled_forward`), `installment_reminder_sent`, `installment_plan_status_changed`
- KPI: **default rate** (plans ending `cancelled`/stalled ÷ total created) — single most important health metric for this feature
- KPI: reminder-to-payment conversion within 48h

---

#### Feature: Guided Stock-Take (الجرد) (Staff Pack, +$5/mo)
**Status:** ✅ Implemented (design approved, build complete per spec)
**The "Job to be Done":** As an owner, I need to know if my inventory is shrinking between counts, to catch theft or loss the transaction-level audit log can't see.
**The Solution:** A guided counting session against a frozen expected-stock snapshot, barcode-scan-to-jump, a variance review screen with extreme-variance safeguards, and a shrinkage-trend history view.
**User/Business Value:** Completes the "see who's stealing" thesis the Staff Pack is sold on; also protects the accuracy of the Profit Report, since profit silently drifts without periodic stock reconciliation.
**📊 Data Analyst Lens:**
- Track: `stock_take_session_started`/`completed` (`total_variance_value_usd`, `line_count`, `extreme_variance_line_count`), `stock_take_session_cancelled`
- KPI: rolling last-3-session shrinkage trend per shop; session-completion rate

---

#### Feature: Product Categories & Subcategories (الفئات) (Core + Reporting Pack)
**Status:** ✅ Implemented (design approved, build complete per spec)
**The "Job to be Done":** As an owner with a large catalog, free-text categories fragment into typo-variants and can't be filtered or reported on reliably — I need a real, structured category system.
**The Solution:** Two-level category/subcategory CRUD, product assignment, filter/sort in the product list and POS, automatic migration of existing free-text values, and a "by category" breakdown in the Profit Report.
**User/Business Value:** Makes large catalogs fast to navigate in POS and turns "which part of my catalog actually makes money" into an answerable question.
**📊 Data Analyst Lens:**
- Track: `category_created`, `product_categorized`, `pos_category_filter_used`, `reports_category_breakdown_viewed`
- KPI: % of catalog left in "غير مصنف" (Uncategorized) — data-quality/adoption proxy

---

#### Feature: Returns & Refunds
**Status:** ✅ Implemented (design approved, build complete per spec)
**The "Job to be Done":** As a cashier, I need to process a customer return against the original sale — partial or full — with a choice of refund method and whether to restock, without corrupting the sale or inventory record.
**The Solution:** A "return" action from Sale History opens a bottom sheet pre-loaded with the original line items; cashier selects items/quantities, chooses restock per item, picks a refund method and reason, and confirms.
**User/Business Value:** Every retail shop has returns; this closes a gap that would otherwise block any real demo or pilot, and keeps refunds properly reflected in revenue/profit rather than silently vanishing or double-counting.
**📊 Data Analyst Lens:**
- Track: `return_initiated`/`completed` (`item_count`, `refund_method`, `restock_flag_per_line`, `reason`)
- KPI: return rate as % of sales, by product/category — quality/expectation-mismatch signal

---

#### Feature: Excel/CSV Exports (per-dataset)
**Status:** ✅ Implemented (design approved, build complete per spec)
**The "Job to be Done":** As an owner, I need to hand my accountant (or just keep for myself) a clean export of sales, expenses, products, or customers — in Excel, with Arabic rendering correctly.
**The Solution:** A dedicated `/exports` page with four datasets, date-range filtering (sales/expenses), and Excel/CSV format choice via SheetJS with RTL worksheet direction.
**User/Business Value:** Directly answers the "what about my accountant?" and "my data is mine" objections that block adoption among more skeptical owners.
**📊 Data Analyst Lens:**
- Track: `export_generated` (`dataset`, `format`, `row_count`, `date_range_used`)
- KPI: export usage rate as a proxy for "serious business" adoption (owners who export tend to be the ones treating the tool as a system of record)

---

#### Feature: WhatsApp Messaging (Receipts + Statements)
**Status:** 🟡 Partially implemented — receipt-send is done and merge-ready; statement-send has one remaining wiring task per the spec's hand-off notes
**The "Job to be Done":** As an owner without a printer (or with a customer who wants a digital copy), I need to send a receipt or account statement over WhatsApp — the channel every Syrian customer already uses.
**The Solution:** A shared, editable "review before send" sheet that formats receipt/statement text and opens `wa.me` with the customer's number pre-filled; receipts also become searchable later (for returns lookups).
**User/Business Value:** Removes the printer as a hard dependency for proof-of-purchase, and gives credit customers a way to see their balance without a portal — WhatsApp *is* the portal, per product strategy.
**📊 Data Analyst Lens:**
- Track: `whatsapp_receipt_sent`, `whatsapp_statement_sent`, `whatsapp_send_cancelled_before_confirm`
- **Known analytical blind spot (documented in the spec itself):** we log "sent" optimistically the moment WhatsApp opens — we cannot detect if the user actually pressed send inside WhatsApp. Any "delivery rate" KPI built on this event will overstate actual sends.

---

### Trust, Accountability & Platform Foundations

These are largely infrastructure-facing rather than owner-facing "features," but they are load-bearing for everything above and were reviewed alongside the epics.

---

#### Feature: In-Shift Cash Management (pay-in / pay-out / drop)
**Status:** ✅ Implemented (design approved, build complete per spec)
**The "Job to be Done":** As a cashier, the drawer legitimately changes for reasons that aren't sales/expenses/refunds (paying a supplier in cash, a safe drop, a float top-up) — today those show up as false "theft" at shift close, which erodes trust in the whole variance feature.
**The Solution:** A dedicated `cash_movements` ledger with fixed reason chips + free text, void-with-reason corrections (never silent edits), and warn-but-allow on overdraw — folded directly into the shift's cash reconciliation and Z-report.
**User/Business Value:** Protects the credibility of the Staff Pack's headline metric (variance). Without this, real day-to-day cash handling generates constant false shortages and the owner stops trusting the number.
**📊 Data Analyst Lens:**
- Track: `cash_movement_recorded` (`type`: pay-in/pay-out/drop, `reason`, `currency`, `amount`, `overdraw_warning_shown`), `cash_movement_voided`
- KPI: false-shortage reduction — compare shift variance rate before/after this feature's rollout per shop

---

#### Feature: Switch Operator (no shift change)
**Status:** ✅ Implemented (design approved, build complete per spec)
**The "Job to be Done":** As a shop with multiple staff, people swap at the register several times a day — forcing a full shift close/reopen (cash count) on every swap is wrong and slow, since swapping who's ringing sales isn't a cash-accountability event.
**The Solution:** Separates "shift" (cash-drawer accountability period) from "operator" (who's currently ringing sales); operators switch via PIN re-entry within one open shift, cart preserved, sale attributed to whoever completes it.
**User/Business Value:** Removes daily friction for any multi-person shop without weakening the accountability model — attribution stays exact, just decoupled from the cash count.
**📊 Data Analyst Lens:**
- Track: `operator_switched` (`from_role`, `to_role`, `cart_preserved: bool`)
- KPI: switches-per-shift distribution — informative for staffing/scheduling patterns per shop

---

#### Feature: Owner-Only Financial Visibility (WAFI-058)
**Status:** ✅ Implemented (client-side gating); server-side enforcement is a separate dependency (see Server-Side Role Enforcement below)
**The "Job to be Done":** As an owner, revenue/profit/expense totals, reports, aggregate credit owed, and per-cashier sales breakdowns are sensitive — I want these hidden from Managers and Cashiers by default, with the ability to explicitly grant a trusted Manager access.
**The Solution:** Financials are Owner-only by default; the Owner can grant `can_view_reports`/`can_view_expenses` to a specific Manager. Transaction-level actions a role must perform (current sale total, a specific customer's balance, processing a return) remain always visible — only the aggregate roll-up is gated.
**User/Business Value:** Prevents a hired manager or cashier from seeing the shop's overall profitability while still letting them do their job — directly protects the owner's core anxiety about staff trust.
**📊 Data Analyst Lens:**
- Track: `financial_access_granted`/`revoked` (Property: `target_role`)
- **Important caveat for analysts:** this is currently client-side gating only; do not treat it as a security boundary when reasoning about data exposure risk until server-side enforcement (WAFI-010) ships.

---

#### Feature: Server-Side Role Enforcement
**Status:** 📅 Planned / Not yet implemented
**The "Job to be Done":** As the product, permission checks today are UI-only — because all staff share one Supabase account per shop, a technically-inclined cashier could bypass the UI (via devtools or direct API calls) and read the owner's profit data, other staff PIN hashes, or the audit log.
**The Solution (planned):** A real per-staff identity layer at the server so "Cashier/Manager/Owner" are enforced by row-level security and API authorization, not just hidden UI — depends on the Real Auth epic below.
**User/Business Value:** This is the actual security half of the "see who's stealing" promise. Until it ships, the permission system is a UX nicety, not a real control — a distinction that matters a great deal if this is ever mentioned to a security-conscious customer or investor.
**📊 Data Analyst Lens (once built):**
- Track: `unauthorized_api_access_blocked` (Properties: `attempted_role`, `resource`) — should be near-zero in normal operation; nonzero values are a genuine security signal, not noise

---

#### Feature: Real Auth, Self-Serve Onboarding & Device Registration
**Status:** 📅 Planned / Not yet implemented
**The "Job to be Done":** Today the product can hold exactly one shop, provisioned by hand, with a hardcoded device identity shared by every install. There is no working self-serve signup/login. This blocks scaling past the founder's own shop.
**The Solution (planned):** Real signup/login wired to the existing (currently mockup) pages, an auth guard on routing, and per-install device registration replacing the hardcoded stub — so a shop owner can sign up, get an isolated shop, sign in on any device, and each device syncs without colliding.
**User/Business Value:** This is the literal gate between "one shop we set up by hand" and "pilots from the Syria trip can onboard themselves on more than one device" — a hard precondition for the self-serve-capable product discipline and for scaling past a handful of hand-provisioned pilots.
**📊 Data Analyst Lens (once built):**
- Track: `signup_completed` (`time_to_first_sale`), `device_registered`, `multi_device_shop_count`
- KPI: self-serve onboarding completion rate — the practical measure of whether "self-serve-capable" is real or aspirational

---

#### Feature: Tenant Isolation Backbone
**Status:** ✅ Implemented (superseded design — see note)
**The "Job to be Done":** Every shop's data must be strictly isolated from every other shop's, both in the database and in the offline sync layer.
**The Solution:** Row-level security scoped via `shops.owner_user_id → auth.uid()`, with sync rules and client reads following the same mapping. (Note: an earlier JWT-claim/access-token-hook design was drafted and explicitly **not shipped** — the current implementation is simpler and is the source of truth; this is flagged so nobody accidentally references the superseded design.)
**User/Business Value:** This is foundational trust infrastructure — a cross-tenant data leak would be catastrophic for a multi-tenant SaaS at any scale, so this isn't optional hardening, it's a prerequisite for having customers at all.
**📊 Data Analyst Lens:** Not a user-facing feature; no product analytics apply. Relevant only as a standing security invariant to periodically verify (e.g., penetration-style spot checks that shop A's device can never read shop B's rows).

---

#### Feature: PWA & Offline Hardening
**Status:** ✅ Implemented (design approved, build complete per spec)
**The "Job to be Done":** The app shell and data layer are offline-first by architecture, but the *experience* around that — install flow, honest network-vs-sync-status detection, service-worker update UX, and offline font/icon completeness — needed dedicated hardening work.
**The Solution:** A first-class PWA install experience, a network-detection layer that doesn't conflate "PowerSync not connected" with "no internet" (previously a misleading-signal bug in demo/local-only mode), and consistent cross-platform icons/fonts available offline.
**User/Business Value:** A shop's trust in the offline promise (Sacred Rule #1) depends on the *indicators* being honest, not just the underlying sync being correct — a wrongly-red "offline" badge on a working connection erodes confidence in the entire product.
**📊 Data Analyst Lens:**
- Track: `pwa_installed`, `sw_update_available_shown`/`applied`
- **Data-quality note for analysts:** before this hardening, "offline" status was keyed off PowerSync connection state, not true network state — any historical sync-status analytics predating this fix should be treated with caution in local-only/demo deployments.

---

#### Feature: Zombie Open Shifts Remediation (WAFI-065)
**Status:** ✅ Implemented (remediation of a gap in the original Epic 5 spec)
**The "Job to be Done":** Shifts were opening but never being closed (device lost, crash, cashier went home), filling `/shifts/history` with perpetually-open shifts and giving the owner no way to resolve them.
**The Solution:** A one-open-shift-per-device guard at open time, plus an explicit, labelled owner force-close for abandoned shifts — deliberately **not** an automatic silent close, since a real close requires a counted cash amount to produce a meaningful variance; auto-closing would fabricate fake variance data.
**User/Business Value:** Restores the trustworthiness of shift history and the variance metric the Staff Pack is sold on — directly addressed a CEO-observed real-world problem ("a lot of shifts never closed, piling up").
**📊 Data Analyst Lens:**
- Track: `shift_force_closed` (Property: `reason: abandoned | owner_initiated`)
- KPI: zombie-shift rate before/after this fix — should trend toward zero

---

#### Feature: PIN Reset & Recovery (WAFI-056)
**Status:** ✅ Implemented (design approved, build complete per spec)
**The "Job to be Done":** Staff have no individual account — they PIN-unlock a shared shop login — so there was no way for a cashier who forgot their PIN to get back to work without the owner, and no way for the owner to recover their own PIN if locked out.
**The Solution:** Owner **and** Manager can reset a Cashier's PIN (Manager cannot reset another Manager's or the Owner's); reset also clears any active lockout.
**User/Business Value:** Removes an operational blocker for any pilot shop where the owner isn't on-site full-time — directly serves Working Principle #9 ("if a feature requires calling someone, it's broken").
**📊 Data Analyst Lens:**
- Track: `pin_reset_performed` (Property: `reset_by_role`, `target_role`)
- KPI: reset frequency per shop — unusually high rates may indicate PIN-hygiene or training issues worth a support touch

---

#### Feature: Owner Remote Visibility — Daily WhatsApp Digest (WAFI-057)
**Status:** ⛔ Deferred — explicitly decided not to build
**The "Job to be Done":** An owner away from the shop wanted a daily WhatsApp summary of the day's numbers.
**Why deferred:** Superseded by the Owner-Only Financials decision above — the digest's premise required an on-site staffer to view and send the numbers, which now contradicts financials being owner-only by default. The correct future vehicle is either a read-only Owner Dashboard app or a genuine backend-driven automated push, both later-stage builds.
**User/Business Value (if revived):** Still a cheap, high-value "see my shop from anywhere" feature — flagged in the roadmap as conditionally revivable if an owner explicitly grants a Manager reporting access.
**📊 Data Analyst Lens:** N/A — not built. If revived, instrument `digest_sent`/`digest_opened` (though WhatsApp open-tracking has the same blind spot noted under WhatsApp Messaging above).

---

### UI/Design System Work (not separately itemized)

Several specs in the repo (homepage redesign, navigation redesign, "luxury" redesign, gradient-glow redesign, general design-system redesign) are visual/UX-polish passes rather than new capabilities — they restyle existing screens rather than adding jobs-to-be-done. They're noted here for completeness but excluded from the value matrix above since they don't map to a distinct feature or KPI; any analyst investigating a metric shift around these dates should check whether a visual redesign (not a behavior change) is the actual cause.

---

## 3. Gap Analysis & Opportunity Discovery

### Hidden Edge Cases

1. **Server-side enforcement gap is a live risk today, not a future one.** Because Owner-Only Financial Visibility (WAFI-058) is client-side gating and Server-Side Role Enforcement hasn't shipped, any Manager or Cashier device technically *can* read profit/expense data directly from the shared Supabase credential right now. This isn't a hidden edge case in the traditional sense — it's a known, documented gap — but it's easy for a PO to mentally file "financials are owner-only" as solved when it is only UI-solved. Any customer-facing claim about staff data privacy should be qualified until WAFI-010 ships.

2. **Installment sale + Stock-Take timing collision.** A stock-take session freezes `expected_stock` at session start, but installment sales already deducted stock at sale time. If several installment sales occur *during* an open stock-take session, the resulting variance is technically correct but the counter has no visual cue that a scanned item's expected count reflects sales made seconds ago — a large variance could be misread as theft when it's normal turnover.

3. **Remote sign-out / force-close vs. in-flight cash movements or installment payments.** If a cashier is mid-way through recording an installment due payment or a cash pay-out when their session is force-closed, the in-progress write simply queues under their `employee_id` — the shift's zero-computed variance (per the force-close design) won't reflect that pending write, creating a discrepancy between "recorded variance" and "actual eventual state" once sync catches up.

4. **Switch Operator + Owner-Only Financials interaction.** Switch Operator explicitly reuses the PIN-prompt as its escalation mechanism ("switching to the owner requires the owner's PIN"). Combined with WAFI-058's grantable financial access, this means a Manager who has been granted `can_view_reports` retains that visibility across every operator switch on a shared device — worth confirming the grant is scoped to the *person*, not accidentally inherited by whoever is next signed in on that device.

5. **WhatsApp "sent" events are optimistic, everywhere they're used.** Both receipt-send and statement-send (and the deferred daily digest) log a "sent" event the instant WhatsApp opens — there is no way to confirm the user actually pressed send inside WhatsApp. This blind spot compounds across every messaging feature in the product, not just one.

### New Feature / Use Case Opportunities

1. **Installment default risk score on the customer profile.** We already track plan creation, due-payment timing (days late), and status changes — a simple "payment reliability" indicator on a customer's profile before extending a *new* plan is a low-build-cost, high-value extension of data already being captured.

2. **Stock-Take-triggered reorder/shrinkage-risk suggestions.** Cross-referencing chronically-shrinking SKUs (from stock-take variance) against the low-stock alert (Epic 2/3) could surface "these items disappear faster than they sell — investigate or reorder tighter," serving the Staff Pack's anti-theft thesis with data already paid for.

3. **Unified "money owed to me" view spanning Credit Ledger + Installments.** Both represent money owed to the shop, and AR aging integration is already flagged as an open question in the Installment spec. A combined aging view answers one of the two core owner anxieties this product exists to solve.

4. **Receiving-to-Profit-Report cost freshness indicator.** Since Epic 8 now lets an owner choose per-line whether a delivery updates the standing cost, a simple "X% of your active catalog's cost was last refreshed via a receiving vs. never updated" indicator would make the Profit Report's accuracy caveat much more actionable than the current binary missing-cost warning.

### Analytical Blind Spots

- **Imported vs. live data contamination risk** (Profit Report). No described enforcement mechanism yet prevents a future Import feature from writing rows silently treated as live by the reporting pipeline — should be a hard schema/query-level guard, not a documentation-only rule.

- **`sync_status: pending` sales across multi-device shops.** A second device's dashboard can't see a sale still pending sync on the device that rang it — multi-device shops will see two dashboards briefly disagree on "today's total." Without explicit instrumentation (`dashboard_value_at_render` + `pending_write_count_at_render`), this reads as a data-integrity bug to analysts investigating anomalies rather than expected sync lag.

- **Zero-down installment plans skew "revenue collected" optics.** Profit recognizes in full on the sale date while cash trickles in via dues — a shop with many 0%-down plans will show strong Profit Report numbers well ahead of actual liquidity, with no current callout distinguishing "profit" from "cash in hand."

- **Stock-take shrinkage trend has no denominator.** `total_variance_value_usd` isn't normalized against total inventory value, so a shop that grows 3x in catalog size shows a rising absolute "shrinkage" number that may actually be a flat or improving rate.

- **WhatsApp delivery/read tracking is fundamentally unavailable** (see Hidden Edge Case 5) — any KPI built on "message sent" events should be labeled as an upper-bound proxy for outreach attempted, never confused with confirmed delivery.

- **Financial-access grants (WAFI-058) have no expiry or review cadence tracked.** Once an Owner grants a Manager `can_view_reports`, there's no visible instrumentation for how long that grant has been active or whether it's ever been revisited — worth tracking `financial_access_granted_at` and surfacing grant age to owners periodically.

---

## 4. Stakeholder Alignment Questions

1. **On the security posture we can honestly claim today:** Given that Owner-Only Financial Visibility is enforced client-side only until Server-Side Role Enforcement ships, how should we describe our staff-data-privacy posture to prospective customers or partners in the meantime — is there a version of "financials are protected" we can say truthfully today, or should any such claim wait for WAFI-010?

2. **On sequencing Real Auth / Server-Side Role Enforcement against feature work:** These two foundational epics are both marked "planned, post-trip" while we continue shipping owner-facing premium features (Installments, Stock-Take, Categories). Is there a point at which shipping more premium features on top of a single-tenant, client-side-only permission model becomes riskier than pausing to build the foundation — and who makes that call?

3. **On the "profit vs. cash" distinction:** As Installment Plans and the Customer Credit Ledger both grow, more recognized profit sits as unrealized cash. Should the Profit Report explicitly separate "recognized profit" from "cash actually collected," or would that complexity work against the plain-language, phone-first discipline we've committed to?

4. **On cross-feature timing conflicts:** Stock-take vs. active sales, remote sign-out vs. in-flight payments, and installment defaults vs. customer risk are all edge cases where independently-designed features interact in ways no single spec fully anticipated. Should we invest in a lightweight cross-epic edge-case review pass before each new feature ships, given how many of these gaps only surfaced in this synthesis?

5. **On instrumentation ownership:** Several of the metrics flagged above (sync-lag transparency, data-source tagging for imported vs. live sales, WhatsApp-sent vs. delivered framing, financial-grant aging) require decisions made *before* the next feature is built, not analytics bolted on after. Who owns flagging these requirements at spec-review time — PM, Data Analyst sign-off, or a checklist item in the existing Definition of Done template?
