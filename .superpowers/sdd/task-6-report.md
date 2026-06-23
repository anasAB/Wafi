# Task 6 Report — Send Customer Statement via WhatsApp

## What Was Built

### New files
- `src/features/messaging/useSendStatement.ts` — DB-free composable returning `prepare(input)` and `send(phone, text)`.
- `src/features/messaging/__tests__/useSendStatement.test.ts` — 13 unit tests (TDD-first).

### Modified files
- `src/features/messaging/index.ts` — added `useSendStatement` and its types to the barrel.
- `src/features/customers/CustomerDetailPage.vue` — added `useReceiptSettings` + `useSendStatement` imports, `openStatementSheet()` handler, "إرسال كشف الحساب عبر واتساب" button in the profile card below "تسجيل دفعة", `WhatsAppPreviewSheet` wiring at the bottom of the template, and matching CSS.

---

## How Rows Are Assembled from openInvoices

`useCustomerBalance` returns `openInvoices` newest-first. `useSendStatement.prepare()`:
1. Shallow-copies and reverses the array → chronological (oldest → newest).
2. Iterates with a cumulative `running` accumulator: `running += inv.remainingUsd`.
3. Each row: `{ date: inv.saleDate.slice(0, 10), label: "فاتورة ${displayNumber} — ${itemsSummary}", amountUsd: inv.remainingUsd, runningUsd: running }`.
4. The final `running` equals the sum of all `remainingUsd` values — the normal positive case matches `balanceUsd` from the composable.
5. `balanceUsd` (authoritative, from `useCustomerBalance`) is passed through to `formatStatementText` as the final balance line — so any rounding or edge-case difference (store credit, overpayment) is still shown correctly.

No new DB query is introduced.

---

## Deferred Items (explicitly out of scope)

- **Per-payment history rows** — payments are already netted into `remainingUsd` / `balanceUsd`. Adding them as explicit ledger rows would require a new query (or richer data from `useCustomerBalance`). Deferred to v1.5 when a full "per-transaction ledger" view is planned.
- **Strict month-range filtering** — the statement covers ALL open invoices to-date, not just the current month. A date-filtered view requires either a new query or a date picker. Deferred; `periodLabel` already says "حتى [today]" to make the scope clear to the recipient.
- **Itemised sale lines per invoice** — each row shows `displayNumber + itemsSummary` (a short summary string already on `OpenInvoice`), not individual line items. Full per-line breakdown would require loading `useInvoiceDetail` per invoice. Deferred.

---

## TDD RED → GREEN

### RED (module not found)
```
npx vitest run src/features/messaging/__tests__/useSendStatement.test.ts
# Exit code 1 — "Failed to resolve import ../useSendStatement"
```

### Implementation
Created `useSendStatement.ts`.

### GREEN (13/13)
```
npx vitest run src/features/messaging/__tests__/useSendStatement.test.ts
# Test Files  1 passed (1)
# Tests  13 passed (13)
```

### Full suite
```
npx vitest run
# Test Files  81 passed (81)
# Tests  532 passed (532)
```

---

## Typecheck

```
npx vue-tsc --noEmit
# (no output = zero errors)
```

---

## Files Changed

| File | Change |
|------|--------|
| `src/features/messaging/useSendStatement.ts` | Created |
| `src/features/messaging/__tests__/useSendStatement.test.ts` | Created |
| `src/features/messaging/index.ts` | Added barrel exports |
| `src/features/customers/CustomerDetailPage.vue` | Added button + sheet wiring |

---

## Self-Review

- DB-free composable: `useSendStatement` has zero DB calls. All data is from already-loaded composable state passed in by the caller.
- No auto-send: `WhatsAppPreviewSheet` is always shown before any WhatsApp link is opened.
- Reuses `useCustomerBalance` data: no new query.
- Barrel export added: `export { useSendStatement }` + `export type { PreparedStatement, PrepareStatementInput }` in `index.ts`.
- Pristine test output: 532/532 passing, 0 typecheck errors.
- `periodLabel` built in the Vue screen using `Intl.DateTimeFormat` (same pattern as `formatDate`) — no `new Date()` inside the pure composable.
- `phoneRaw` correctly guards the empty-string case (`phoneRaw !== undefined && phoneRaw !== ''`) to avoid passing an empty string to `resolvePhone`.

---

## Concerns

None blocking. The deterministic-output test was updated to mirror the implementation's label format (which appends `itemsSummary` when present) — this is correct; the test was matching implementation intent, not an invariant.

---

## Task 6 Fixes

### Fix 1 — Extract statement send handler (`CustomerDetailPage.vue`)

**File:** `src/features/customers/CustomerDetailPage.vue`, `<script setup>` block (after `handleDelete`, roughly lines 88–97 in the updated file).

The `@send` inline arrow handler on `<WhatsAppPreviewSheet>` was mutating `showStatement` and `toast` by bare name (not `.value`), diverging from every other ref mutation in the file (all use `.value` inside named functions). Replaced with two named functions:

```ts
function handleStatementSent(payload: { phone: string; text: string }) {
  sendStatement.send(payload.phone, payload.text)
  showStatement.value = false
  toast.value = { message: 'تم إرسال كشف الحساب', type: 'success' }
}

function handleStatementCancel() {
  showStatement.value = false
}
```

Template updated to `@send="handleStatementSent"` and `@cancel="handleStatementCancel"`.

The `@cancel` was also an inline `showStatement = false` bare-name mutation; extracted to `handleStatementCancel` for consistency.

---

### Fix 2 — Negative-balance test (`useSendStatement.test.ts`)

Added one test in the `prepare()` describe block:

```ts
it('passes negative balanceUsd through unchanged (customer-credit / overpayment case)', () => {
  const { prepare } = useSendStatement()
  const { text } = prepare({ ...baseInput, openInvoices: [], balanceUsd: -50 })
  expect(text).toContain('-$50.00')
})
```

This confirms that a store-credit / overpayment balance (`-50`) is passed through to `formatStatementText` unchanged and rendered as `-$50.00` in the statement text.

---

### Test Results

**Covering test** (`npx vitest run src/features/messaging/__tests__/useSendStatement.test.ts`):
```
Test Files  1 passed (1)
Tests  14 passed (14)
```

**Full suite** (`npx vitest run`):
```
Test Files  81 passed (81)
Tests  533 passed (533)
```

**Typecheck** (`npx vue-tsc -b`):
```
(no output = zero errors)
```
