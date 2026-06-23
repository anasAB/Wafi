# WhatsApp Messaging (Receipt + Statement) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send WhatsApp receipts (per sale) and statements (per credit customer) via free `wa.me` links, plus search sale history by receipt number to enable returns.

**Architecture:** A shared messaging core (phone resolution + `wa.me` launcher + an editable review-before-send sheet), two pure text formatters (receipt, statement) that reuse existing data builders, and a sale-number search in history. Text only; no WhatsApp API.

**Tech Stack:** Vue 3 + Pinia, PowerSync (local SQLite), Vitest, TypeScript.

## Global Constraints
- **Free `wa.me` only** — no WhatsApp Business API, no Meta account, no per-message cost.
- **Text messages only** — no PDF/image attachment.
- **Review-before-send** — every message shows an editable preview; never auto-send.
- **Returns source of truth = the looked-up sale record**, never the message text.
- Offline-first: composing the message + link works offline (data is local); the actual send needs network + WhatsApp.
- Plain-language Arabic for all user-facing text.
- New feature folder: `src/features/messaging/`. Reuse `receipt_settings` and the `ReceiptData` shape from `src/composables/usePrinter.ts`.

---

### Task 1: WhatsApp core — phone resolution + `wa.me` launcher

**Files:**
- Create: `src/features/messaging/whatsapp.ts`
- Test: `src/features/messaging/__tests__/whatsapp.test.ts`

**Interfaces:**
- Produces: `resolvePhone(raw: string | null | undefined, countryCode?: string): string | null` (digits-only intl form, no `+`; default `countryCode = '963'`). `buildWaMeUrl(phone: string, text: string): string`. `openWhatsApp(phone: string, text: string): void`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { resolvePhone, buildWaMeUrl } from '../whatsapp'

describe('resolvePhone', () => {
  it('keeps an already-international number', () => expect(resolvePhone('+963944123456')).toBe('963944123456'))
  it('converts a local leading-zero number', () => expect(resolvePhone('0944123456')).toBe('963944123456'))
  it('prepends country code to a bare local number', () => expect(resolvePhone('944123456')).toBe('963944123456'))
  it('strips spaces/dashes', () => expect(resolvePhone('0944 123-456')).toBe('963944123456'))
  it('returns null for empty/too-short/null', () => {
    expect(resolvePhone('')).toBeNull()
    expect(resolvePhone('12')).toBeNull()
    expect(resolvePhone(null)).toBeNull()
  })
})

describe('buildWaMeUrl', () => {
  it('builds an encoded link', () =>
    expect(buildWaMeUrl('963944123456', 'مرحبا 1$')).toBe('https://wa.me/963944123456?text=' + encodeURIComponent('مرحبا 1$')))
})
```

- [ ] **Step 2: Run it, verify it fails** — `npx vitest run src/features/messaging/__tests__/whatsapp.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// src/features/messaging/whatsapp.ts
/** Normalize a phone to wa.me international form (digits only, no '+'). Null if unusable. */
export function resolvePhone(raw: string | null | undefined, countryCode = '963'): string | null {
  if (!raw) return null
  let d = raw.replace(/[^\d+]/g, '')
  if (d.startsWith('+')) d = d.slice(1)
  else if (d.startsWith('00')) d = d.slice(2)
  else if (d.startsWith('0')) d = countryCode + d.slice(1)
  else if (!d.startsWith(countryCode)) d = countryCode + d
  return d.length >= 11 ? d : null   // country code + local (>= ~8 digits)
}

export function buildWaMeUrl(phone: string, text: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`
}

export function openWhatsApp(phone: string, text: string): void {
  window.open(buildWaMeUrl(phone, text), '_blank')
}
```

- [ ] **Step 4: Run it, verify it passes.**
- [ ] **Step 5: Commit** — `git commit -m "feat(messaging): wa.me phone resolution + launcher"`

---

### Task 2: Receipt text formatter

**Files:**
- Create: `src/features/messaging/receiptText.ts`
- Test: `src/features/messaging/__tests__/receiptText.test.ts`

**Interfaces:**
- Consumes: `ReceiptData` (from `src/composables/usePrinter.ts`).
- Produces: `formatReceiptText(receipt: ReceiptData, opts?: { returnPolicy?: string }): string`.

- [ ] **Step 1: Write the failing test** — assert the output contains: the shop name, the receipt number (prominent), each line (`name × qty`), the USD total and the SYP total, and the footer/return-policy when provided.

```ts
import { describe, it, expect } from 'vitest'
import { formatReceiptText } from '../receiptText'

const receipt = {
  saleId: 's1', displaySaleNumber: 'A-000247', shopName: 'محل وافي',
  createdAt: '2026-06-23T10:00:00Z',
  lines: [{ nameAr: 'قهوة', quantity: 2, unitPriceUsd: 1.5, lineTotalUsd: 3 }],
  totalUsd: 3, totalSyp: 43500, exchangeRate: 14500, paymentMethod: 'cash_usd',
} as any

describe('formatReceiptText', () => {
  it('includes shop, number, item, both totals', () => {
    const t = formatReceiptText(receipt)
    expect(t).toContain('محل وافي')
    expect(t).toContain('A-000247')
    expect(t).toContain('قهوة')
    expect(t).toMatch(/3(\.00)?\s*\$|\$\s*3/)
    expect(t).toContain('43,500')
  })
  it('includes a return-policy line when given', () =>
    expect(formatReceiptText(receipt, { returnPolicy: 'الإرجاع خلال ٧ أيام' })).toContain('الإرجاع خلال ٧ أيام'))
})
```

- [ ] **Step 2: Run it, verify it fails.**
- [ ] **Step 3: Implement** — a pure function building the Arabic text from `ReceiptData`: header (shop name + optional `headerText`), `رقم الفاتورة: <displaySaleNumber>`, date, a line per item (`nameAr × qty = $lineTotal`), `الإجمالي: $totalUsd` and `<totalSyp.toLocaleString()> ل.س`, payment/change, then `footerText` and the optional `returnPolicy`. Keep it readable on a phone.
- [ ] **Step 4: Run it, verify it passes.**
- [ ] **Step 5: Commit** — `git commit -m "feat(messaging): receipt text formatter"`

---

### Task 3: Review-before-send sheet + send-receipt wiring

**Files:**
- Create: `src/features/messaging/components/WhatsAppPreviewSheet.vue` (shared, reused by statement)
- Create: `src/features/messaging/useSendReceipt.ts`
- Modify: `src/features/pos/SaleConfirmationScreen.vue` (add "إرسال عبر واتساب" action; read first — confirm how it builds/has `ReceiptData` and the customer/phone context)
- Modify: `src/features/sale-history/...` row UI to offer "send via WhatsApp" (read first)
- Test: `src/features/messaging/__tests__/useSendReceipt.test.ts`

**Interfaces:**
- Consumes: `resolvePhone`, `openWhatsApp` (Task 1); `formatReceiptText` (Task 2); `receipt_settings` (shop name/footer + return-policy line).
- Produces: `WhatsAppPreviewSheet` props `{ text: string }`, emits `send(editedText)` / `cancel`. `useSendReceipt()` → `prepare(receipt, phoneRaw?)` returning `{ text, phone }` and `send(phone, text)`.

- [ ] **Step 1: Write the failing test** — `useSendReceipt.prepare(receipt)` produces text via `formatReceiptText` and a resolved phone (null when none); `send(phone, text)` calls `openWhatsApp`. Mock `whatsapp.ts`.
- [ ] **Step 2: Run it, verify it fails.**
- [ ] **Step 3: Implement** `useSendReceipt` + the `WhatsAppPreviewSheet` (a sheet showing an editable `<textarea>` of the text + "إرسال" / "إلغاء"). The flow: build text → if phone resolves, open the sheet prefilled; on "إرسال" call `openWhatsApp(phone, editedText)`. If no phone, show a number input first, then proceed.
- [ ] **Step 4: Wire into the confirmation screen + history row** — add an "إرسال الفاتورة عبر واتساب" button on `SaleConfirmationScreen.vue` (beside/replacing the dead print button) and on each sale-history row. Customer attached → prefill `resolvePhone(customer.phone || customer.mobile)`; walk-in → number input; no number → the sheet asks for one.
- [ ] **Step 5: Run tests + manual check** — send a receipt with a customer (prefilled) and as a walk-in (enter number); confirm WhatsApp opens with the right text.
- [ ] **Step 6: Commit** — `git commit -m "feat(messaging): send receipt via WhatsApp (preview + wiring)"`

---

### Task 4: Search sale history by receipt number

**Files:**
- Modify: `src/features/sale-history/useSaleHistory.ts` (add `searchByNumber`)
- Modify: the sale-history page UI to add a search box (read first)
- Test: `src/features/sale-history/__tests__/useSaleHistory.test.ts`

**Interfaces:**
- Produces: `searchByNumber(query: string): Promise<void>` — sets `sales` to matches on `display_sale_number` (exact or prefix), scoped by `shop_id`, newest first.

- [ ] **Step 1: Write the failing test** — seed two sales with numbers `A-000247`, `A-000248`; `searchByNumber('A-000247')` returns the one; a prefix `A-0002` returns both; an unknown number returns empty. Match is shop-scoped.
- [ ] **Step 2: Run it, verify it fails.**
- [ ] **Step 3: Implement** — add `searchByNumber` querying `SELECT * FROM sales WHERE shop_id = ? AND display_sale_number LIKE ? ORDER BY created_at DESC` (param `query%`), mapping rows the same way `loadHistory` does. Reuse the existing row mapper if practical (DRY).
- [ ] **Step 4: Wire the UI** — a search box on the sale-history page; on submit call `searchByNumber`; tapping a result opens the sale (where reprint / WhatsApp / start-return are available). The return itself uses the existing returns flow on the real sale (source of truth).
- [ ] **Step 5: Run tests + manual check** — type a receipt number, open the sale, start a return from it.
- [ ] **Step 6: Commit** — `git commit -m "feat(history): search sales by receipt number (returns lookup)"`

---

### Task 5: Statement text formatter

**Files:**
- Create: `src/features/messaging/statementText.ts`
- Test: `src/features/messaging/__tests__/statementText.test.ts`

**Interfaces:**
- Produces: `formatStatementText(input: { customerName: string; shopName: string; periodLabel: string; rows: Array<{ date: string; label: string; amountUsd: number; runningUsd: number }>; balanceUsd: number }): string`.

- [ ] **Step 1: Write the failing test** — assert the text contains the greeting + customer name, the period label, a line per transaction with its running balance, and the final balance owing (in plain language, e.g. `الرصيد المستحق`).
- [ ] **Step 2: Run it, verify it fails.**
- [ ] **Step 3: Implement** — pure function producing the Arabic statement text. No data access here (the caller supplies `rows`/`balanceUsd`).
- [ ] **Step 4: Run it, verify it passes.**
- [ ] **Step 5: Commit** — `git commit -m "feat(messaging): statement text formatter"`

---

### Task 6: Send-statement on the customer screen

**Files:**
- Create: `src/features/messaging/useSendStatement.ts`
- Modify: `src/features/customers/CustomerDetailPage.vue` (add "إرسال كشف الحساب"; read first to reuse the balance + transaction data already loaded there / in `useCustomerBalance` / `useInvoiceDetail`)
- Test: `src/features/messaging/__tests__/useSendStatement.test.ts`

**Interfaces:**
- Consumes: `resolvePhone`, `openWhatsApp` (Task 1); `formatStatementText` (Task 5); `WhatsAppPreviewSheet` (Task 3); the customer's credit sales + payments + running balance (existing customer composables).
- Produces: `useSendStatement()` → `prepare(customer, period?)` returning `{ text, phone }`; `send(phone, text)`.

- [ ] **Step 1: Write the failing test** — `prepare(customer)` for a customer with credit activity builds rows (date/label/amount/running) and a balance, formats via `formatStatementText`, and resolves the phone; `send` calls `openWhatsApp`. Default period = current month.
- [ ] **Step 2: Run it, verify it fails.**
- [ ] **Step 3: Implement** — `useSendStatement` assembles rows from the existing balance/history queries (default current-month period), formats, and uses the shared preview sheet.
- [ ] **Step 4: Wire into `CustomerDetailPage.vue`** — an "إرسال كشف الحساب عبر واتساب" button; opens the preview sheet (editable); on send → WhatsApp. Prefill the customer's number; if missing, the sheet asks.
- [ ] **Step 5: Run tests + manual check** — send a statement for a credit customer; confirm WhatsApp opens with the running balance + total owing.
- [ ] **Step 6: Commit** — `git commit -m "feat(messaging): send customer statement via WhatsApp"`

---

## Self-Review

**Spec coverage:**
- Free `wa.me`, text-only → Tasks 1–2, 5 (no API anywhere) ✓
- Shared core (phone + launcher + review-before-send) → Task 1 + the `WhatsAppPreviewSheet` in Task 3 (reused in Task 6) ✓
- Receipt message + send from confirmation & history → Tasks 2, 3 ✓
- Statement message + send from customer screen → Tasks 5, 6 ✓
- Search by receipt number → returns lookup → Task 4 ✓
- Returns validated against the real sale, not the text → Task 4 Step 4 (return uses the existing flow on the looked-up sale) ✓
- Customization (reuse receipt_settings + edit-before-send + optional return-policy line) → Task 2 `opts.returnPolicy` + the editable preview sheet; **decision: compose the return-policy/greeting at send time (reuse `receipt_settings.footer_text`); no new migration** ✓
- Offline composition → all formatters are pure + read local data ✓

**Sequencing:** core (1) → receipt formatter (2) → send-receipt (3) → search (4) → statement formatter (5) → send-statement (6). Receipt is shippable after Task 4; statement after Task 6 — so it can split into two PRs if desired.

**Reads-before-edit for the implementer:** `SaleConfirmationScreen.vue` and the sale-history row/page UI (Tasks 3, 4), and `CustomerDetailPage.vue` + `useCustomerBalance`/`useInvoiceDetail` (Task 6) — reuse the data they already load; don't duplicate queries.

**Type consistency:** `resolvePhone`/`buildWaMeUrl`/`openWhatsApp` (Task 1) used unchanged in Tasks 3, 6. `formatReceiptText(ReceiptData, opts)` (Task 2) and `formatStatementText(input)` (Task 5) signatures match their callers. `WhatsAppPreviewSheet` props/emits consistent across Tasks 3 and 6.
