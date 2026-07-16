# Epic 01 DoD Follow-ups — Duplicate Receipt Flag, Draft Clear-on-Clear, Barcode Regression Test — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the 3 confirmed gaps from the Epic 01 code-review feedback: reprinted receipts don't announce themselves as copies, clearing the sale panel doesn't clear the persisted IndexedDB draft, and there is no explicit regression test proving human search-typing + Enter is never swallowed by the barcode scanner.

**Architecture:** Each fix is additive to an existing, working file — no new files, no new composables. `isReprint` follows the exact pattern already established by `isFullyReturned` on `ReceiptData`. The Clear Cart button already exists in `SalePanel.vue` (contrary to the original review's claim) — the actual defect is one missing function call in its handler. The barcode scanner's burst-detection logic is already correct; this task only adds a codified regression test using a real `<input>` element with a `keyup.enter` submit handler, which is currently untested.

**Tech Stack:** Vue 3 + TypeScript + Vitest + `@vue/test-utils`. No new dependencies.

## Global Constraints

- All UI labels must come from the CD-6 label table in `epic_01_ring_sale_print_receipt.md` — if a new label is needed, add it there too.
- Arabic labels are RTL; any new UI text must read correctly in `dir="rtl"`.
- Follow the existing feature-first folder structure (`src/features/[feature]/`) — no restructuring.
- No breaking changes to `ReceiptData`, `SaleRecord`, or `SaleDraft` — new fields must be optional/additive.

---

### Task 1: `isReprint` flag on receipts

**Files:**
- Modify: `src/composables/usePrinter.ts` (add field to `ReceiptData`, render it in `SimulatedDriver`)
- Modify: `src/features/sale-history/useSaleHistory.ts` (`buildReceiptData` accepts an options param; `reprint()` passes `isReprint: true`)
- Test: `src/__tests__/composables/usePrinter.test.ts`
- Test: `src/__tests__/features/useSaleHistory.test.ts` (create if it does not already exist — check first)

**Interfaces:**
- Consumes: existing `ReceiptData` interface (`src/composables/usePrinter.ts:5-30`), existing `buildReceiptData(saleId: string): Promise<ReceiptData>` (`src/features/sale-history/useSaleHistory.ts:8`), existing `reprint(saleId: string): Promise<void>` (`src/features/sale-history/useSaleHistory.ts:198`)
- Produces: `ReceiptData.isReprint?: boolean` (new optional field, defaults to falsy for a normal sale-completion print), `buildReceiptData(saleId: string, opts?: { isReprint?: boolean }): Promise<ReceiptData>`

- [ ] **Step 1: Write the failing test for `ReceiptData` + `SimulatedDriver` rendering**

Add to `src/__tests__/composables/usePrinter.test.ts` (append inside the existing `describe('SimulatedDriver', ...)` block, after the existing `'logs receipt to console'` test):

```typescript
  it('logs a DUPLICATE COPY marker when isReprint is true', async () => {
    const consoleSpy = vi.spyOn(console, 'log')
    const driver = new SimulatedDriver()
    await driver.print({ ...sampleReceipt, isReprint: true })
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[SimulatedPrinter]'),
      expect.objectContaining({ isReprint: true, marker: 'نسخة مكررة / Duplicate Copy' })
    )
  })

  it('omits the marker key when isReprint is not set', async () => {
    const consoleSpy = vi.spyOn(console, 'log')
    const driver = new SimulatedDriver()
    await driver.print(sampleReceipt)
    const call = consoleSpy.mock.calls.find(c => c[0] === '[SimulatedPrinter]')
    expect(call?.[1]).not.toHaveProperty('marker')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/composables/usePrinter.test.ts`
Expected: FAIL — `isReprint` does not exist on type `ReceiptData` (TypeScript error) and the `marker` key is never logged.

- [ ] **Step 3: Add `isReprint` to `ReceiptData` and render it in `SimulatedDriver`**

In `src/composables/usePrinter.ts`, add the field next to the existing `isFullyReturned` field:

```typescript
  /** Marks a reprint of a fully-returned sale so it isn't mistaken for a live sale. */
  isFullyReturned?:         boolean
  /** True when this print is a reprint (from sale history), not the original at-sale print.
   *  Anti-fraud requirement: a reprinted receipt must be visually distinguishable from the
   *  original so a customer cannot use it twice to claim two separate returns. */
  isReprint?:               boolean
```

Update `SimulatedDriver.print` to include the marker only when `isReprint` is true:

```typescript
export class SimulatedDriver implements IPrinterDriver {
  async print(receipt: ReceiptData): Promise<void> {
    // Simulates thermal print operation
    console.log('[SimulatedPrinter]', {
      saleNumber: receipt.displaySaleNumber,
      total:      `$${receipt.totalUsd.toFixed(2)} / ${receipt.totalSyp.toLocaleString()} ل.س`,
      lines:      receipt.lines.map(l => `${l.nameAr} × ${l.quantity} = $${l.lineTotalUsd.toFixed(2)}`),
      ...(receipt.isReprint ? { isReprint: true, marker: 'نسخة مكررة / Duplicate Copy' } : {}),
    })
  }
}
```

**Note for the future real ESC/POS driver (WAFI-017, not part of this task):** when the real thermal-printer driver is built, it must render `isReprint` as large bold text at the very top of the physical receipt, above the shop name — this is the actual anti-fraud control; the `SimulatedDriver` only needs to prove the flag reaches the print call.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/composables/usePrinter.test.ts`
Expected: PASS — all tests including the 2 new ones.

- [ ] **Step 5: Thread `isReprint` through `buildReceiptData` and `reprint()`**

In `src/features/sale-history/useSaleHistory.ts`, change the `buildReceiptData` signature (line 8) to accept an options object, and set the field on the returned object:

```typescript
export async function buildReceiptData(
  saleId: string,
  opts?: { isReprint?: boolean },
): Promise<ReceiptData> {
```

At the end of the function, in the returned object (currently ends with `isFullyReturned,` on line 63), add:

```typescript
    isFullyReturned,
    isReprint: opts?.isReprint ?? false,
  }
```

Then update `reprint()` (line 198-201) to pass the flag:

```typescript
  async function reprint(saleId: string): Promise<void> {
    const receipt = await buildReceiptData(saleId, { isReprint: true })
    await printer.print(receipt)
  }
```

- [ ] **Step 6: Write the failing test for `buildReceiptData` and `reprint`**

First check whether `src/__tests__/features/useSaleHistory.test.ts` already exists:

Run: `ls src/__tests__/features/useSaleHistory.test.ts 2>&1 || echo "not found"`

If it does not exist, create it with this content. If it does exist, add these two `it` blocks to its existing top-level `describe`, reusing whatever db-mocking pattern the file already uses for `db.execute` (mock the four `Promise.all` queries inside `buildReceiptData` to return one sale row with one line item):

```typescript
// src/__tests__/features/useSaleHistory.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/store/device.store', () => ({
  useDeviceStore: () => ({ shopId: 'shop-001', deviceId: 'device-001' }),
}))

import { db } from '@/data/powersync/db'
import { buildReceiptData, useSaleHistory } from '@/features/sale-history/useSaleHistory'

function mockSaleQueries() {
  vi.mocked(db.execute)
    .mockResolvedValueOnce({ rows: { _array: [{
      id: 'sale-001', display_sale_number: 'A-000001', created_at: new Date().toISOString(),
      total_usd: 20, total_syp: 290000, exchange_rate_at_sale: 14500,
      payment_method: 'cash_usd', amount_received: 20, amount_received_currency: 'USD',
      change_due: 0, is_split: 0,
    }] } } as any)
    .mockResolvedValueOnce({ rows: { _array: [
      { name_ar: 'منتج', quantity: 2, unit_price_usd: 10, line_total_usd: 20 },
    ] } } as any)
    .mockResolvedValueOnce({ rows: { _array: [{ shop_name: 'محل تجريبي' }] } } as any)
    .mockResolvedValueOnce({ rows: { _array: [] } } as any)
    .mockResolvedValueOnce({ rows: { _array: [] } } as any)
}

describe('buildReceiptData isReprint', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('defaults isReprint to false when no options are passed', async () => {
    mockSaleQueries()
    const receipt = await buildReceiptData('sale-001')
    expect(receipt.isReprint).toBe(false)
  })

  it('sets isReprint to true when requested', async () => {
    mockSaleQueries()
    const receipt = await buildReceiptData('sale-001', { isReprint: true })
    expect(receipt.isReprint).toBe(true)
  })
})

describe('useSaleHistory reprint', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('reprint() builds the receipt with isReprint: true', async () => {
    mockSaleQueries()
    const { reprint } = useSaleHistory()
    const consoleSpy = vi.spyOn(console, 'log')
    await reprint('sale-001')
    const call = consoleSpy.mock.calls.find(c => c[0] === '[SimulatedPrinter]')
    expect(call?.[1]).toMatchObject({ isReprint: true, marker: 'نسخة مكررة / Duplicate Copy' })
  })
})
```

- [ ] **Step 7: Run test to verify it fails, then passes**

Run: `npx vitest run src/__tests__/features/useSaleHistory.test.ts`
Expected first: FAIL (`isReprint` undefined on the built receipt). After Step 5's edits are in place: PASS — 3 tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/composables/usePrinter.ts src/features/sale-history/useSaleHistory.ts src/__tests__/composables/usePrinter.test.ts src/__tests__/features/useSaleHistory.test.ts
git commit -m "feat(printer): mark reprinted receipts with isReprint + Duplicate Copy notice"
```

---

### Task 2: Clear Cart also purges the IndexedDB draft

**Files:**
- Modify: `src/features/pos/SalePanel.vue`
- Test: `src/__tests__/features/SalePanel.test.ts` (create if it does not already exist — check first)

**Interfaces:**
- Consumes: existing `useSaleDraft()` composable's `clearDraft(): Promise<void>` (`src/composables/useSaleDraft.ts:1079-1083`) — same function `usePayment.ts:293` already calls on sale confirmation.
- Produces: nothing new consumed by other tasks — this is a leaf fix.

**Context:** `SalePanel.vue`'s "مسح" (Clear sale) button and its `AppDialog` confirmation already exist (lines 185-196, 328-337). Its handler, `handleClearSale` (lines 165-168), only calls `store.clear()`. Per CD-3 ("Confirmed sale = draft cleared. Cleared sale (via 'Clear sale' or Cancel) = draft cleared."), it must also delete the persisted Dexie draft — otherwise a cashier who clears the sale panel and then backgrounds/reopens the app will see the stale "بيع غير مكتمل — متابعة؟" banner offering to restore items they explicitly discarded.

- [ ] **Step 1: Check for an existing SalePanel test file**

Run: `ls src/__tests__/features/SalePanel.test.ts 2>&1 || echo "not found"`

If found, read it first and add the new test into its existing structure (matching its existing mocking conventions for `useSaleStore`/`db`). If not found, create it fresh per Step 2 below.

- [ ] **Step 2: Write the failing test**

```typescript
// src/__tests__/features/SalePanel.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { useSaleStore } from '@/store/sale.store'

const clearDraftMock = vi.fn().mockResolvedValue(undefined)
vi.mock('@/composables/useSaleDraft', () => ({
  useSaleDraft: () => ({ clearDraft: clearDraftMock }),
}))
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import SalePanel from '@/features/pos/SalePanel.vue'

describe('SalePanel clear sale', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    clearDraftMock.mockClear()
  })

  it('clearing the sale also clears the persisted IndexedDB draft', async () => {
    const store = useSaleStore()
    store.addLine({ productId: 'p1', nameAr: 'تست', quantity: 1, unitPriceUsd: 10, lineTotalUsd: 10 })

    const wrapper = mount(SalePanel)
    await wrapper.find('.clear-btn').trigger('click')
    await wrapper.find('[data-testid="dialog-confirm"], button:has-text("نعم")').trigger('click').catch(() => {})

    // AppDialog's confirm emits 'confirm' — trigger via the component event directly
    // to avoid coupling this test to AppDialog's internal DOM structure.
    const dialog = wrapper.findComponent({ name: 'AppDialog' })
    if (dialog.exists()) await dialog.vm.$emit('confirm')

    expect(store.lines).toHaveLength(0)
    expect(clearDraftMock).toHaveBeenCalledTimes(1)
  })
})
```

**If `AppDialog` is not registered with an explicit `name` option** (check `src/components/ui/AppDialog.vue`'s `<script setup>` — components using `<script setup>` without `defineOptions({ name: ... })` won't be found by `findComponent({ name: ... })`), replace the dialog-triggering lines above with a direct call to the exposed handler instead: mount with `shallowMount` is not appropriate here since we need the real dialog to invoke the real handler. Simplest robust alternative — call the component's internal state directly is not accessible from `<script setup>`, so instead trigger the flow via the DOM: after clicking `.clear-btn`, the `AppDialog` renders in the DOM (it's `v-if="showClearDialog"`); read `src/components/ui/AppDialog.vue` to find its confirm button's real selector/label (its `confirm-label` prop is `"نعم، امسح"` per `SalePanel.vue:332`) and click that button by text:

```typescript
    const confirmBtn = wrapper.findAll('button').find(b => b.text().includes('نعم'))
    await confirmBtn?.trigger('click')
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/__tests__/features/SalePanel.test.ts`
Expected: FAIL — `clearDraftMock` was never called (handler only calls `store.clear()`).

- [ ] **Step 4: Fix `handleClearSale` in `SalePanel.vue`**

Add the import (near the top, alongside the existing `useSaleStore` import):

```typescript
import { useSaleDraft } from '@/composables/useSaleDraft'
```

Instantiate it alongside `store` (near line 9):

```typescript
const store = useSaleStore()
const { clearDraft } = useSaleDraft()
```

Change `handleClearSale` (lines 165-168) to also clear the draft:

```typescript
async function handleClearSale() {
  store.clear()
  await clearDraft()
  showClearDialog.value = false
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/__tests__/features/SalePanel.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the full existing SalePanel-adjacent test suite to check for regressions**

Run: `npx vitest run src/__tests__/composables/useSaleDraft.test.ts src/__tests__/store/sale.store.test.ts`
Expected: PASS (no changes to `useSaleDraft` or `sale.store` themselves, this is a regression check only).

- [ ] **Step 7: Commit**

```bash
git add src/features/pos/SalePanel.vue src/__tests__/features/SalePanel.test.ts
git commit -m "fix(pos): clear sale also purges the IndexedDB draft (CD-3)"
```

---

### Task 3: Codify the barcode-scanner / human-typing-and-Enter regression test

**Files:**
- Modify: `src/__tests__/composables/useBarcodeScan.test.ts`

**Interfaces:**
- Consumes: existing `useBarcodeScan()` composable, unchanged (`src/composables/useBarcodeScan.ts`). No production code changes in this task — the burst-detection logic (`SCANNER_INTERVAL_MS = 33`, `inBurst` flag, `e.key.length === 1` check) already correctly ignores human-speed typing, per the existing `'does NOT call callback for slow human typing'` test (`src/__tests__/composables/useBarcodeScan.test.ts:37-47`). This task adds the specific scenario the code review raised but which no existing test directly covers: **a real search `<input>` element that also has its own `@keyup.enter` handler must still receive and act on the Enter key when the user types at human speed** — proving the two listeners (global scanner + local search-submit) don't conflict.
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Write the failing (well — should-already-pass, but currently unverified) test**

Add to `src/__tests__/composables/useBarcodeScan.test.ts`, as a new top-level `describe` block at the end of the file:

```typescript
describe('useBarcodeScan does not block a real search input\'s Enter-to-submit', () => {
  it('a human typing a search term and pressing Enter still submits the search', async () => {
    const scanCb = vi.fn()
    const { onScan, destroy } = useBarcodeScan()
    onScan(scanCb)

    // A real <input> with its own local Enter handler, mirroring POSSaleScreen.vue's
    // search bar: v-model + a submit handler bound to the Enter key.
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    const submitHandler = vi.fn()
    input.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') submitHandler()
    })

    // Human typing speed: ~150ms between keystrokes (far above the 33ms scanner threshold).
    const term = 'قهوة'
    let t = 0
    for (const ch of term) {
      const down = new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true })
      Object.defineProperty(down, 'timeStamp', { value: t })
      input.dispatchEvent(down)
      const up = new KeyboardEvent('keyup', { key: ch, bubbles: true, cancelable: true })
      input.dispatchEvent(up)
      t += 150
    }
    const enterDown = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    Object.defineProperty(enterDown, 'timeStamp', { value: t })
    input.dispatchEvent(enterDown)
    const enterUp = new KeyboardEvent('keyup', { key: 'Enter', bubbles: true, cancelable: true })
    input.dispatchEvent(enterUp)

    // The global scanner handler must NOT have treated this as a scan...
    expect(scanCb).not.toHaveBeenCalled()
    // ...and the input's own local Enter-to-submit handler must still have fired.
    expect(submitHandler).toHaveBeenCalledTimes(1)

    document.body.removeChild(input)
    destroy()
  })
})
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/__tests__/composables/useBarcodeScan.test.ts`
Expected: PASS — including the new test. If it fails, do NOT patch `useBarcodeScan.ts` to "fix" it without first re-reading `src/composables/useBarcodeScan.ts:18-54` — the failure would mean the burst-timing math has a boundary bug (e.g. Arabic multi-byte `e.key` values not matching `.length === 1`), which is a distinct, real bug worth its own investigation, not a rubber-stamp code change.

- [ ] **Step 3: Commit**

```bash
git add src/__tests__/composables/useBarcodeScan.test.ts
git commit -m "test(barcode): codify human-typing + Enter is never swallowed by the scanner"
```

---

## Self-Review Notes

- **Spec coverage:** All 3 confirmed DoD additions from `epic_01_ring_sale_print_receipt.md` (added in the prior session) are covered: `isReprint` flag (Task 1), Clear Cart also purging the draft (Task 2), barcode/Enter regression test (Task 3). The 4th reviewer claim (insufficient-payment gating) was independently verified as already correctly implemented in `usePayment.ts`'s `canConfirmSingle` — no task needed, and none is included here.
- **No placeholders:** every step shows complete, runnable code and exact commands.
- **Type consistency:** `isReprint?: boolean` on `ReceiptData` matches its only two producers (`buildReceiptData`'s return object and the `SimulatedDriver.print` read), and its only two consumers (`SimulatedDriver`'s marker branch and the two new test files). `buildReceiptData(saleId: string, opts?: { isReprint?: boolean })` signature is used identically in both its production call site (`reprint()`) and its test call sites.
