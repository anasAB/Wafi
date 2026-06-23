# WhatsApp Messaging (Receipt + Statement) — Design

> Date: 2026-06-23
> Status: Approved (pending spec review)
> Pack: Core (receipt) + Customer (statement)
> Sacred Rules touched: Offline-first (1), Arabic (2)
> Delivers: Epic 4.6 (WhatsApp statement) + the WhatsApp half of Epic 6 (WhatsApp receipt).

## Problem

The brother's shop has no printer, so a sold customer currently walks away with **no proof of purchase** — and paper receipts get lost. Credit customers also have no easy way to see what they owe. WhatsApp is universal in Syria and is the product's intended customer channel ("WhatsApp is the portal"). We need to send receipts and statements over WhatsApp, and make a sent receipt usable to find the sale later (e.g. for returns).

## Decisions (locked during brainstorming)

1. **Free `wa.me` click-to-chat only** — no WhatsApp Business API, no paid messaging, no Meta account. The owner reviews and taps send from their own WhatsApp.
2. **Text messages only** — `wa.me` cannot reliably attach a PDF/image. Receipts and statements are formatted Arabic text. (Image receipts are explicitly deferred.)
3. **One shared messaging core, two message types** (receipt, statement) — not two separate features.
4. **The system record is the source of truth for returns** — a returned sale is always found by looking up the real sale; the customer's WhatsApp text is only a human reference (it can be edited, so it is never trusted).
5. **The receipt number already exists** (`sales.display_sale_number`) — the new work is fast **lookup by that number**, not adding a number.
6. **Reuse existing receipt assembly** — `useSaleHistory.reprint()` already builds a full `ReceiptData`; the WhatsApp receipt reuses that data and adds a text formatter + send path.

## Architecture

```
              ┌─────────────── shared messaging core ───────────────┐
              │  phone resolution → message preview (editable) →     │
              │  wa.me launcher (open chat with prefilled text)      │
              └──────────────────────────────────────────────────────┘
                         ▲                              ▲
        Receipt text formatter (ReceiptData→text)   Statement text formatter
                         ▲                              ▲
   Send-receipt action (confirmation screen,      Send-statement action
   sale-history row)                              (customer detail)

   Returns enabler:  search sale history by receipt number / customer name
                     → open sale → reprint | WhatsApp | start return
```

## Components

### Shared core
- **`resolvePhone(raw): string | null`** — normalize a phone to `wa.me` international format (digits only, country code; Syria default where applicable). Returns null if unusable. Sources: `customers.phone`/`mobile`, or manual entry.
- **WhatsApp launcher** — `openWhatsApp(phone, text)`: builds `https://wa.me/<phone>?text=<encodeURIComponent(text)>` and opens it (new tab/app). On desktop this opens WhatsApp Web. If no phone, the caller handles the "enter a number" path.
- **Review-before-send** — a preview UI showing the composed Arabic text, editable, with a "Send via WhatsApp" button. Used by both message types. This is also where per-message customization happens.

### Message type A — Receipt
- **`formatReceiptText(receipt: ReceiptData, settings): string`** — Arabic text: shop name, **receipt number (prominent)**, date/time, line items (name × qty = total), totals USD + SYP, payment method / change or new balance, footer text + optional return-policy line.
- **Send-receipt action** — added to:
  - `SaleConfirmationScreen.vue` (replaces/sits beside the now-dead print button).
  - each `sale-history` row (send a past receipt).
  - Customer attached → prefill number; walk-in → "enter number"; no number → skip (sale already recorded).

### Message type B — Statement
- **`formatStatementText(customer, transactions, balance, period): string`** — Arabic text: greeting, shop name, period (default current month), each credit sale + payment with running balance, total owing, polite closing.
- **Send-statement action** — on `CustomerDetailPage.vue`; review-before-send.

### Returns enabler
- **Search sale history by receipt number (and customer name)** — extend `useSaleHistory` with a `searchByNumber(query)` that matches `display_sale_number` (exact/prefix) and opens the sale. From the opened sale the owner can reprint, WhatsApp, or start a return (existing returns flow).
- The return itself is unchanged and always operates on the real sale row.

### Customization (reuse, minimal)
- Reuse `receipt_settings` (shop name, header, footer, tax number).
- Add an optional **return-policy / thank-you line** for receipts and a **statement greeting** — stored in settings (one migration if needed) or composed at send time.
- Per-message edit-before-send covers everything else. **No template designer.**

## Data flow

- **Receipt:** sale confirmed (or selected in history) → build `ReceiptData` (existing builder) → `formatReceiptText` → resolve phone → preview/edit → `openWhatsApp`.
- **Statement:** open customer → load credit sales + payments + running balance (existing balance/history queries) → `formatStatementText` → preview/edit → `openWhatsApp`.
- **Returns:** owner types the receipt number → `searchByNumber` → open the real sale → start return (existing flow).

## Error handling & edge cases

- **No phone (walk-in):** offer "enter a number" or skip; never block the sale.
- **Unusable/short number:** `resolvePhone` returns null → prompt to fix or skip.
- **Desktop:** `wa.me` opens WhatsApp Web — works; the link is the same.
- **Customer has no WhatsApp:** the message simply won't deliver; the owner sees that in their own WhatsApp (outside our app). Documented, not handled.
- **Offline:** composing the message + link works offline; the actual send needs network + WhatsApp installed. The receipt/statement data is local, so composition is always available.
- **Returns trust:** never validate a return from the message text — always from the looked-up sale (decision 4).

## Out of scope

- WhatsApp Business API, automated/bulk/scheduled sends, delivery receipts, inbound messages (a customer's reply lands in the owner's WhatsApp, not in Wafi).
- Image/PDF receipts (text only).
- A receipt-template designer (reuse `receipt_settings` + edit-before-send).

## Testing

- Unit: `resolvePhone` (valid/invalid/various formats), `formatReceiptText` and `formatStatementText` (correct Arabic content, receipt number present, dual-currency totals, running balance), `wa.me` URL building/encoding.
- Unit: `searchByNumber` returns the right sale by `display_sale_number`.
- Flow: send-receipt with customer attached (prefilled) vs walk-in (enter number) vs no number (skip); send-statement for a credit customer.

## Definition of Done

- [ ] Owner can send a receipt over WhatsApp from the confirmation screen and from a past sale; receipt shows the prominent receipt number + dual-currency totals.
- [ ] Walk-in (no customer) path: enter a number or skip; sale is unaffected.
- [ ] Owner can send a credit customer their statement (current-month default) over WhatsApp.
- [ ] Every send shows an editable preview first (review-before-send); never auto-sends.
- [ ] Owner can search sale history by receipt number, open the sale, and start a return from it.
- [ ] Returns are validated against the real sale record, never the message text.
- [ ] Works offline for composition; uses only free `wa.me` (no API).
- [ ] Reuses `receipt_settings`; optional return-policy/greeting line; no template designer.
