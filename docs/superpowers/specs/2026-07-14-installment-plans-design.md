# Installment / Layaway Plans (التقسيط) — Design Spec

**Status:** Approved design, ready for planning
**Pack:** Customer Pack (+$5/month) — no new SKU
**Depends on:** Epic 4 (Customer Credit Ledger) — customer records, ledger balance, payment recording, WhatsApp send plumbing. Reuses the `wa.me` messaging plumbing from `specs/2026-06-23-whatsapp-messaging-design.md`.
**Build order:** First of the two 2026-07-14 candidate features (ahead of Stock-take). Rationale: table-stakes for electronics/appliance retail (customer #0's vertical), low marginal build cost (reuses existing customer/payment/WhatsApp infrastructure), and creates strong lock-in — the installment book becomes the shop's most business-critical record.

---

## Epic summary

**Goal:** Owner/cashier can sell an item on a structured installment plan (down payment + fixed term + schedule), collect each installment against that schedule, and remind customers of upcoming or overdue dues via WhatsApp — distinct from the informal "on account" credit ledger already built in Epic 4.

**Value delivered:** Installment purchases are a cultural staple for MENA electronics/appliance retail. Today the shop either tracks this on paper or overloads the informal on-account balance with no schedule, no due dates, and no reminder mechanism. This gives the owner a real installment book with dates, amounts, and one-tap reminders — while reusing Epic 4's balance, statement, and offline-sync machinery rather than duplicating it.

**In scope:** Installment plan creation from a sale (down payment + term count + frequency), auto-generated due schedule, payment recording against a specific due (including overpayment rollover), a lightweight bulk **reschedule** action, plan status tracking (active/completed/defaulted/cancelled), dashboard "Installments due" card, one-tap WhatsApp reminder per due, offline support (inherits Epic 4's model).

**Out of scope:** Automatic/unattended reminder push (no server-side scheduler exists yet — sending is one tap, not zero), late fees / penalty interest, credit scoring or plan eligibility rules, multi-plan-per-sale, per-due editing of individual amounts/dates (the Reschedule action shifts all remaining dues uniformly — see below; anything finer is a cancel-and-re-create), **partial returns on an installment sale** (a return on a plan requires cancelling the whole plan and ringing a new sale for any kept items — not in scope for v1), AR aging integration (flagged as an open question for whenever AR aging is specced), customer merge tooling (a customer with an active plan cannot be deleted — see Edge Cases — but merging two customer records is not built here).

---

## Data model

### `installment_plan`

| Field | Type | Required | Notes |
|---|---|---|---|
| plan_id | UUID | yes | |
| customer_id | UUID | yes | FK → existing customer (Epic 4) |
| sale_id | UUID | yes | FK → the sale that created the plan; sale's total/COGS already recorded via Epic 1 |
| total_amount | decimal (USD) | yes | Matches ledger's USD-internal convention |
| down_payment | decimal (USD) | yes | Collected at sale time; posts as an immediate ledger payment (Epic 4 Story 4.6 mechanism) |
| term_count | integer | yes | Number of installments, > 0 |
| term_frequency | enum | yes | `weekly` \| `monthly` (monthly default) |
| start_date | date | yes | First due date |
| status | enum | yes | `active` \| `completed` \| `defaulted` \| `cancelled` |
| created_at | timestamp | yes | |
| created_by | string | yes | |
| sync_status | enum | yes | Matches Epic 4 pattern |

### `installment_due`

| Field | Type | Required | Notes |
|---|---|---|---|
| due_id | UUID | yes | |
| plan_id | UUID | yes | FK |
| due_date | date | yes | Generated at plan creation, not recomputed |
| amount_due | decimal (USD) | yes | Even split of `(total_amount - down_payment)` across `term_count`; last installment absorbs rounding remainder |
| amount_paid | decimal (USD) | yes | Running total from linked ledger payments tagged to this `due_id` |
| status | enum | yes | `upcoming` \| `due` \| `overdue` \| `paid` |

---

## Core flow

1. Cashier rings a sale (Epic 1) with 1+ items and reaches the payment screen.
2. A new payment method **"تقسيط" (Installment)** appears alongside Cash USD, Cash SYP, Card, On account.
3. Cashier selects/creates a customer (reuses Epic 4's customer selector, Story 4.2).
4. Cashier enters: down payment amount, term count, frequency (weekly/monthly), start date (defaults to today + 1 period).
5. **If `down_payment` is 0:** show a non-blocking warning — "تحذير: لا توجد دفعة أولى" (Warning: no down payment) — with a second confirmation tap required before proceeding. Not blocked outright (0% down is a legitimate, common structure in this market), just flagged so a cashier doesn't enter it by accident.
6. App computes the even installment schedule and shows a preview: "دفعة أولى: X، ثم N دفعة من Y ابتداءً من [date]".
7. On confirm: `installment_plan` + `installment_due` rows are created; the down payment posts as an immediate payment against the customer's ledger balance (Epic 4 Story 4.6 mechanism — same balance the on-account flow already uses); the sale completes normally with `payment_method = "installment"`; receipt shows the plan summary.
8. Each subsequent collection is recorded through the existing Record Payment flow (Epic 4 Story 4.6), entered from the plan/due context so it's tagged against the correct `due_id`; `amount_paid` accumulates and `status` flips to `paid` once it reaches `amount_due`. **Overpayment on a specific due** (payment amount exceeds that due's remaining `amount_due - amount_paid`): the excess is automatically applied to the next chronological unpaid due in the same plan; if there is no next unpaid due (this was the last one), the excess posts as a general credit to the customer's Epic 4 ledger balance, exactly like today's on-account overpayment handling (Story 4.6's existing overpayment confirmation dialog).

### Due schedule date math

`due_date` for installment N is `start_date` plus N periods (weeks or months). **Month-end clamping:** when adding months lands on a day that doesn't exist in the target month (e.g., Jan 31 + 1 month), clamp to the last valid day of that month (Jan 31 → Feb 28/29, not a rolled-over March date). This must be a single shared date-math helper, not duplicated inline per call site, since every due in a plan is generated from it.

### Reschedule (إعادة جدولة)

A lightweight alternative to cancel-and-re-create for the common real-world case ("can we push the schedule back?"): from the plan view, a **"إعادة جدولة" (Reschedule)** action lets the owner/cashier shift every remaining (`upcoming`/`due`/`overdue`) due's `due_date` forward by a chosen number of days (e.g., +14). Already-`paid` dues are untouched. This is a bulk `due_date` update on the plan's unpaid dues — it does not change `amount_due`, `term_count`, or create/cancel any rows. Finer renegotiation (changing amounts, adding/removing installments) remains out of scope — cancel and re-create for that.

---

## WhatsApp reminders

- **Dashboard card: "أقساط مستحقة" (Installments due)** — count + total value due today/this week, tappable → list of due installments. **Sort order:** overdue dues pinned to the top regardless of date, then the remainder sorted by `due_date` ascending (soonest first).
- From that list, tapping a customer opens their detail screen (Epic 4). The customer detail screen must explicitly list that customer's active installment plan(s) and their current status (not just buried in transaction history), with a **one-tap "إرسال تذكير" (send reminder)** button per upcoming/overdue due.
- **Missing phone number:** the "إرسال تذكير" button is disabled (grayed out) with a tooltip/helper text — "يجب إضافة رقم هاتف للعميل أولاً" (must add customer phone number first) — mirroring the existing disabled-Send pattern on Epic 4's statement button (Story 4.7).
- Reminder message template: *"السلام عليكم [name]، تذكير بموعد القسط: [amount] بتاريخ [date]. الرصيد المتبقي: [remaining]. — [shop name]"*.
- Reminders are owner/cashier-triggered (one tap), not an automatic background push — no server-side scheduler exists in the current architecture.

---

## Report / dashboard integration

- **Revenue/profit recognition:** unchanged from how on-account sales already work. The full sale total and its margin are recognized on the sale date via the existing Profit Report / dashboard pipeline (Epic 1/Profit Report screen), not spread across installments. No new logic.
- **Cash position:** only the down payment and later collected dues affect actual cash-in / the shift cash drawer indicator, same as any on-account payment today.
- **"Customers owe you" card (Epic 4, home screen):** requires no separate aggregation — the customer's ledger balance already increases by the full sale total when the plan is created (down payment posts as an immediate payment against it), so outstanding installment value is included in that total for free.
- **New surface:** the "Installments due" dashboard card is a *schedule* view (what's due when), distinct from the *balance* view Epic 4 already provides.
- **Open question for later:** when AR aging (30/60/90) is eventually specced, it should probably bucket installment dues by their own `due_date` rather than by last-activity date — not decided now, just flagged.

---

## Edge cases

1. **Early full payoff** — remaining dues collapse to `paid`; no penalty/discount logic (not in scope).
2. **Missed due date** — status flips to `overdue` (shown red); surfaces on the dashboard card (pinned to top) and customer detail; no auto late-fee (flagged as an open question for v1.5+, pending brother's real-world feedback).
3. **Partial payment against a due** — allowed; `amount_paid` accumulates; due stays `due` until it reaches `amount_due`.
4. **Overpayment against a due** — excess rolls forward to the next unpaid due, or to the customer's general ledger balance as credit if none remain (Core flow, step 8).
5. **Zero down payment** — allowed but requires an explicit second confirmation tap with a visible warning (Core flow, step 5); not blocked, since 0%-down plans are a real structure in this market.
6. **Month-end date math** — adding a month to a due date that would land on a non-existent day (e.g., Jan 31) clamps to the last valid day of the target month, via a single shared date-math helper (Core flow, "Due schedule date math").
7. **Plan cancelled mid-term** (e.g., customer returns goods) — plan status → `cancelled`; remaining dues voided, not deleted (append-only, matching the audit-log discipline used elsewhere in the product). A **partial** return (some items on the sale, not all) is not supported — the cashier cancels the whole plan and returns/re-sells as needed (see Out of scope).
8. **Customer deletion with an active plan** — blocked. A customer with any `active` installment plan cannot be soft-deleted; the UI surfaces why (mirrors how a real business record shouldn't vanish out from under a live obligation). This is a business rule enforced at the same site as Epic 4's customer delete, not a new mechanism.
9. **Offline** — plan creation, due status changes, payments, and reschedule all follow Epic 4's existing offline/sync model since they use the same underlying tables/pattern (additive updates, no destructive conflicts).
10. **Exchange rate drift across the plan's life** — each payment stores its own exchange rate at entry (matches Epic 4 Story 4.6 convention); balance accounting stays USD-internal and stable.

---

## Definition of Done

- [ ] Cashier can create an installment plan from a sale in about the same time as an on-account sale
- [ ] Down payment posts correctly to the customer's ledger balance immediately
- [ ] Due schedule generates correctly for any term_count/frequency combination, with rounding absorbed into the last installment
- [ ] Date math correctly handles month-end clamping (e.g., Jan 31 + 1 month = Feb 28/29) via a single shared helper
- [ ] Plan creation warns (does not block) and requires a second confirmation tap when down_payment is 0
- [ ] Recording a payment against a specific due updates that due's status and the customer's overall balance correctly
- [ ] Overpayment on a due correctly rolls forward to the next unpaid due, or to the customer's general ledger balance if none remain
- [ ] Reschedule action correctly shifts all remaining (upcoming/due/overdue) due dates by the entered offset, leaving paid dues untouched
- [ ] "Installments due" dashboard card shows correct counts/totals, sorted overdue-first then soonest-first, and updates in near-real-time
- [ ] Customer detail screen explicitly lists that customer's active installment plan(s) and current status
- [ ] "إرسال تذكير" (send reminder) is disabled with helper text when the customer has no phone number
- [ ] A customer with an active installment plan cannot be deleted
- [ ] One-tap WhatsApp reminder opens with correct pre-filled message and customer number
- [ ] Sale total and margin appear correctly in the Profit Report on the sale date, not spread across installments
- [ ] Plan survives 10+ offline mixed operations (creation, due payments, reschedule, cancellation) with correct final state on sync
- [ ] All Arabic text uses plain language, consistent with existing product voice
- [ ] Tested on phone, tablet, desktop, online and offline
