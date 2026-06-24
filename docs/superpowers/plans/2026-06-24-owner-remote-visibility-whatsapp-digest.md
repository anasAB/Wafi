# WAFI-057 — Owner remote visibility: daily WhatsApp digest

> ⛔ **DEFERRED (2026-06-24). Do not build.**
> Superseded by the **owner-only financials** decision (see WAFI-058). The digest's
> premise was "the owner is away, an **on-site staffer** sends him the numbers." With
> financials now **owner-only**, no on-site staffer may see or send them — and the owner,
> being away, isn't there to tap send. A self-service "owner sends himself a digest" is
> redundant with just opening the dashboard. The correct vehicle for owner-only remote
> visibility is the **read-only Owner Dashboard app** (needs WAFI-055 + WAFI-010) or an
> **automated push** (needs a backend + WhatsApp Business API). Revisit then. The original
> spec is kept below for reference only.
>
> *Conditional revival (WAFI-058 flexible grants):* if the Owner **grants a Manager**
> `can_view_reports`, that manager becomes an on-site viewer who could send the digest to
> the away owner — so this isn't permanently dead. Still low priority vs. the read-only app;
> if revived, the send gate becomes `can_view_reports` (granted manager or owner), not role.

> Date: 2026-06-24 · Owner: PO · Priority: ~~P2~~ DEFERRED · Pack: Reporting (+$5/mo) · Area: messaging / dashboard
> CLAUDE.md v1 line: "Daily WhatsApp digest to owner." Serves the "Owner Dashboard (phone-only, read-only)" need cheaply.
> Builds on the existing WhatsApp pattern (`src/features/messaging/`). No backend, no new app surface.

---

## The story

The owner is often **not** behind the register — they have staff running the shop. The
v1 promise is that the owner can see business health *from their own phone, from
anywhere*. CLAUDE.md frames this as a separate read-only "Owner Dashboard" app, but
that app is gated by real auth + multi-device + roles (WAFI-055 / WAFI-010) and is a
v1.5+ build. The **cheap 80%-value version that ships now** is a **daily summary
message sent to the owner over WhatsApp** — reusing the same free `wa.me`,
review-before-send mechanism we already use for receipts and statements.

**As** a shop owner who isn't at the shop,
**I want** a short daily summary of my shop's numbers on WhatsApp,
**so that** I know if I made money, what's running low, and who owes me — without
calling the shop or being there.

At end of day (shift close, or any time from the dashboard), the on-site operator
taps "Send daily summary," reviews the generated Arabic message, and sends it to the
owner's saved WhatsApp number. The owner gets it on their phone wherever they are.

> **What this is NOT (v1 honesty):** this is **not** an automated scheduled push. True
> "arrives at 9pm automatically" needs a backend job + the paid WhatsApp Business API —
> out of the €100–200/mo budget and against our locked "wa.me, text-only,
> review-before-send" decision. The send is operator-initiated. Automated scheduling is
> a deferred, separate piece (see "Deferred" below).

---

## PO decisions (2026-06-24)
- **Mechanism:** operator-initiated `wa.me`, review-before-send — identical pattern to
  receipts/statements. No backend, no WhatsApp Business API.
- **Who can send:** staff with `can_view_reports` (Owner + Manager). The digest exposes
  revenue/profit, which cashiers are not permitted to see — and the review step shows the
  numbers to whoever sends it. **Trade-off noted:** if only a cashier is present at
  close, the owner does not get an auto-digest in v1; that gap is what real automation
  (deferred) or the read-only app would close. *(Open question for PO: accept this, or
  allow a cashier to send a "blind" digest they can't read? Recommend: accept for v1.)*
- **Recipient:** the owner's WhatsApp number, stored in shop settings. If missing, prompt
  to add it (one-time).
- **Profit honesty:** the digest reuses WAFI-054 — if any of the day's sales had a missing
  cost, the profit line is labelled "تقديري / estimated."

---

## Scope

### In
1. **Digest text builder** — `src/features/messaging/digestText.ts`, mirroring
   `statementText.ts`. Pure function: takes the day's metrics → returns an Arabic-first
   (RTL-correct), dual-currency message string. Unit-tested.
2. **Send action** — `useSendDigest.ts`, mirroring `useSendStatement.ts`: gathers metrics,
   builds text, opens the review sheet, sends via `whatsapp.ts` (`wa.me` + normalized
   number).
3. **Review-before-send UI** — reuse `WhatsAppPreviewSheet.vue`.
4. **Entry points:** a "Send daily summary / إرسال ملخص اليوم" action on (a) the dashboard
   (`HomePage.vue`) and (b) the shift-close / Z-report flow. Gated by `can_view_reports`.
5. **Owner number storage** — read the owner WhatsApp number from shop settings; if absent,
   route the user to set it, then continue.

### Out
- Automated scheduling / unattended push (needs backend + WhatsApp Business API — deferred).
- A separate read-only Owner Dashboard app (deferred, see below).
- Per-owner customization of which metrics appear (fixed set for v1).
- Email digest (no email rail).

---

## Digest contents (fixed v1 set)
Header: shop name + date (local). Then, for the **local calendar day** (same boundary as
the dashboard — WAFI-007):
- **Money in** — revenue net of refunds (USD + SYP at current rate).
- **Money out** — expenses for the day.
- **Profit** — money in − cost − expenses; labelled "تقديري/estimated" if any sale had a
  missing cost (WAFI-054).
- **Sales count** — number of invoices.
- **Cash in drawer** — closing balance (if a shift is/was open today).
- **Low stock** — top N items at/under threshold (reuse `useLowStockAlerts`), "+X more" if longer.
- **Outstanding credit** — total currently owed by customers (aggregate balance).
- Footer: who sent it + that it was generated by Wafi.

Keep it short — it must read cleanly in a WhatsApp bubble on a phone.

---

## Edge cases (must all be handled)
- **No owner number saved** → prompt to add it (shop settings), then resume; never a silent
  no-op or a broken `wa.me` link.
- **Empty day (0 sales)** → still produces a valid "0 sales today" digest, not a malformed
  or empty message.
- **Profit is estimated** (missing costs) → the profit line carries the estimated label
  (consistency with WAFI-054); never present a wrong number as exact.
- **No shift open today** → omit the cash-drawer line gracefully (don't show a stale/false 0).
- **Offline** → digest generation is fully local and works offline; the actual *send*
  depends on WhatsApp + connectivity. Compose offline, deliver when WhatsApp has network —
  state this; do not claim guaranteed delivery.
- **Cashier-only present** → the action is hidden/disabled (no `can_view_reports`); document
  that the owner won't receive an auto-digest in that case (the v1 trade-off).
- **Owner is the sender** (owner is also the operator) → allowed; self-send is harmless.
- **Number formatting / currency / RTL** → reuse the formatting helpers used by
  statements; verify Arabic numerals/punctuation and dual currency render correctly.
- **Exchange rate** → SYP figures use the current rate at send time; the message is a
  snapshot, not a live document.

---

## Acceptance Criteria
- [ ] From the dashboard and from shift-close, an Owner/Manager can send a daily summary to
      the owner's WhatsApp via a review-before-send sheet.
- [ ] The action is unavailable to staff without `can_view_reports`.
- [ ] The message shows money in, money out, profit (estimated-labelled when costs are
      missing), sales count, cash drawer (when a shift exists), low stock (top N), and
      outstanding credit — in Arabic, RTL, dual currency.
- [ ] If no owner number is saved, the flow guides the user to add one and then continues.
- [ ] An empty day produces a valid, readable digest.
- [ ] Day boundary matches the dashboard metrics exactly (UTC+3 test).
- [ ] `digestText.ts` is unit-tested for: normal day, empty day, estimated-profit day,
      no-shift day, long low-stock list (truncation).

## Definition of Done
`digestText.ts` unit tests green (cases above); send flow verified on device — number
prompt path, normal send, empty-day send — in `ar`. Permission gate verified (cashier
can't see the action). Merged, `npm run build` green, existing messaging tests pass.

## Touch points (orientation)
New: `src/features/messaging/digestText.ts`, `useSendDigest.ts` (+ tests). Reuse:
`whatsapp.ts`, `WhatsAppPreviewSheet.vue`, `useDashboardMetrics`, `useLowStockAlerts`,
customer-balance aggregate, `useCashDrawer`, shop-settings (owner number),
`router/permissions.ts` (`can_view_reports` gate), i18n `ar`/`en`.

---

## Deferred companion — separate read-only Owner Dashboard app (v1.5+)
The full CLAUDE.md vision is a distinct **phone-only, read-only** surface the owner signs
into on their *own* device — the third composable app alongside POS and Back Office. **Do
not build now.** It depends on:
- **WAFI-055** (real auth + device registration — the owner needs to sign in on their own device), and
- **WAFI-010** (role enforcement — "read-only" must be enforced server-side, not just hidden UI).

Until those land, this digest is the owner's remote-visibility channel. Revisit the
standalone read-only app in v1.5 once owner-away + multi-device are real; at that point its
job is "glance at health, can't mutate anything," reusing the same metrics composables this
ticket already exercises.
