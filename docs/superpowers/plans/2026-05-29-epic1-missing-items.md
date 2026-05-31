# Epic 1 — Missing Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 13 missing or incorrect items from the Epic 1 spec across the POS, payment, sync, and exchange rate flows.

**Architecture:** All changes are targeted fixes to existing files. One new UI state (`card-confirm`) is added to the existing payment state machine. Camera scan wires the existing `useBarcodeScan.startCamera()` composable into `POSSaleScreen` via an overlay template. The USB scanner focus guard adds `e.preventDefault()` on detected burst keystrokes inside `useBarcodeScan`. `SyncIndicator` gains an inline detail panel rendered conditionally; `useSync` exposes a `syncNow()` action.

**Tech Stack:** Vue 3 + TypeScript, Pinia, Tailwind CSS, `@zxing/browser` (already in `package.json`), Vitest + jsdom

---

## File Map

| File | Change |
|------|--------|
| `src/features/payment/payment.types.ts` | Add `lines[]` to `CompletedSale`; add `'card-confirm'` to `PaymentState` |
| `src/features/payment/usePayment.ts` | Populate `lines` from store; card → `card-confirm` state; update `back()` |
| `src/components/ui/NumericKeypad.vue` | Add optional `confirmDisabled` prop |
| `src/features/payment/PaymentModal.vue` | Fix labels; add card-confirm template; add insufficient message; pass `confirmDisabled` |
| `src/features/pos/SaleConfirmationScreen.vue` | Pass `sale.lines` to printer; add "العودة للرئيسية" link |
| `src/features/pos/SalePanel.vue` | Fix empty state text; add "مسح" button + AppDialog; add swipe-left delete |
| `src/features/exchange-rate/ExchangeRateEditor.vue` | Show "السعر يجب أن يكون أكبر من صفر" when input ≤ 0 |
| `src/features/pos/POSSaleScreen.vue` | Fix barcode toast; add camera icon + camera overlay |
| `src/composables/useBarcodeScan.ts` | Focus guard: `e.preventDefault()` on burst chars 2+; refactor `startCamera` to accept `HTMLVideoElement` |
| `src/features/sync/useSync.ts` | Add `syncNow()` that calls `db.connect()` |
| `src/features/sync/SyncIndicator.vue` | Make tappable; add inline detail panel |
| `src/__tests__/features/usePayment.test.ts` | Add lines-populated test; update card-state test |
| `src/__tests__/composables/useBarcodeScan.test.ts` | Add focus-guard test |

---

## Task 1 — Fix receipt line items + "العودة للرئيسية" link

**Files:**
- Modify: `src/features/payment/payment.types.ts`
- Modify: `src/features/payment/usePayment.ts`
- Modify: `src/features/pos/SaleConfirmationScreen.vue`
- Modify: `src/__tests__/features/usePayment.test.ts`

**Bug:** `SaleConfirmationScreen` passes `lines: []` to the printer so no items ever print. `CompletedSale` has no `lines` field. Also missing "العودة للرئيسية" link.

- [ ] **Step 1: Write failing test**

Add to `src/__tests__/features/usePayment.test.ts` (inside the existing `describe('usePayment', ...)` block, after the last `it(...)`):

```typescript
it('confirm() includes sale lines from store', async () => {
  const { selectMethod, confirm } = usePayment()
  selectMethod('card')
  const completed = await confirm()
  expect(completed.lines).toHaveLength(1)
  expect(completed.lines[0].nameAr).toBe('منتج')
  expect(completed.lines[0].quantity).toBe(1)
  expect(completed.lines[0].unitPriceUsd).toBe(10)
})
```

- [ ] **Step 2: Run test and confirm it fails**

```
npx vitest run src/__tests__/features/usePayment.test.ts
```

Expected: FAIL — `completed.lines` is undefined.

- [ ] **Step 3: Add `lines` to `CompletedSale` in `payment.types.ts`**

Replace the `CompletedSale` interface with:

```typescript
export type PaymentMethod = 'cash_usd' | 'cash_syp' | 'card'
export type PaymentState  = 'method-selection' | 'amount-entry' | 'card-confirm' | 'confirming' | 'confirmed'

export interface SaleLine {
  nameAr:       string
  quantity:     number
  unitPriceUsd: number
  lineTotalUsd: number
}

export interface CompletedSale {
  saleId:                  string
  displaySaleNumber:       string
  totalUsd:                number
  totalSyp:                number
  exchangeRateAtSale:      number
  paymentMethod:           PaymentMethod
  amountReceived?:         number
  amountReceivedCurrency?: 'USD' | 'SYP'
  changeDue?:              number
  createdAt:               string
  lines:                   SaleLine[]
}
```

Note: `'card-confirm'` is added to `PaymentState` here — it is used in Task 3.

- [ ] **Step 4: Populate `lines` in `usePayment.ts` `confirm()`**

In `src/features/payment/usePayment.ts`, locate the `const sale: CompletedSale = { ... }` block inside `confirm()`. Add the `lines` field:

```typescript
const sale: CompletedSale = {
  saleId,
  displaySaleNumber:      displayNum,
  totalUsd:               totalUsd.value,
  totalSyp:               totalSyp.value,
  exchangeRateAtSale:     saleStore.lockedExchangeRate!,
  paymentMethod:          method.value,
  amountReceived:         amountReceived.value ?? undefined,
  amountReceivedCurrency: method.value === 'cash_syp' ? 'SYP' : 'USD',
  changeDue:              changeDue.value ?? undefined,
  createdAt:              now,
  lines:                  saleStore.lines.map(l => ({
    nameAr:       l.nameAr,
    quantity:     l.quantity,
    unitPriceUsd: l.unitPriceUsd,
    lineTotalUsd: l.lineTotalUsd,
  })),
}
```

- [ ] **Step 5: Run test and confirm it passes**

```
npx vitest run src/__tests__/features/usePayment.test.ts
```

Expected: all tests PASS.

- [ ] **Step 6: Fix `SaleConfirmationScreen.vue` — pass lines + add "العودة للرئيسية"**

In `src/features/pos/SaleConfirmationScreen.vue`, replace the entire file with:

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { usePrinter } from '@/composables/usePrinter'
import AppToast from '@/components/ui/AppToast.vue'
import type { CompletedSale } from '@/features/payment/payment.types'
import { useDeviceStore } from '@/store/device.store'
import type { ReceiptData } from '@/composables/usePrinter'

const router  = useRouter()
const device  = useDeviceStore()
const printer = usePrinter()
const toast   = ref<{ message: string; type: 'success' | 'error' } | null>(null)

const sale = (history.state as any)?.sale as CompletedSale | undefined

const methodLabels: Record<string, string> = {
  cash_usd: 'نقداً دولار',
  cash_syp: 'نقداً ليرة',
  card:     'بطاقة',
}

async function handlePrint() {
  if (!sale) return
  const receipt: ReceiptData = {
    saleId:                 sale.saleId,
    displaySaleNumber:      sale.displaySaleNumber,
    shopName:               device.shopId,
    createdAt:              sale.createdAt,
    lines:                  sale.lines,
    totalUsd:               sale.totalUsd,
    totalSyp:               sale.totalSyp,
    exchangeRate:           sale.exchangeRateAtSale,
    paymentMethod:          sale.paymentMethod,
    amountReceived:         sale.amountReceived,
    amountReceivedCurrency: sale.amountReceivedCurrency,
    changeDue:              sale.changeDue,
  }
  try {
    await printer.print(receipt)
    toast.value = { message: 'تم إرسال الفاتورة للطباعة', type: 'success' }
  } catch {
    toast.value = { message: `خطأ في الطباعة: ${printer.error.value}`, type: 'error' }
  }
}
</script>

<template>
  <div class="flex flex-col min-h-dvh items-center justify-center px-6 text-center">
    <div class="w-20 h-20 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center mb-6">
      <span class="text-4xl" aria-hidden="true">✓</span>
    </div>

    <h1 class="text-2xl font-bold text-gray-900 dark:text-white mb-2">تم البيع بنجاح</h1>
    <p class="text-lg text-blue-600 dark:text-blue-400 font-mono font-semibold mb-6">
      {{ sale?.displaySaleNumber ?? '—' }}
    </p>

    <div class="bg-gray-50 dark:bg-gray-800 rounded-2xl p-5 w-full max-w-sm mb-6 text-right space-y-2">
      <div class="flex justify-between text-sm">
        <span class="text-gray-500">المجموع</span>
        <span class="font-semibold">${{ sale?.totalUsd.toFixed(2) }}</span>
      </div>
      <div class="flex justify-between text-sm">
        <span class="text-gray-500">بالليرة</span>
        <span class="font-semibold">{{ sale?.totalSyp.toLocaleString() }} ل.س</span>
      </div>
      <div class="flex justify-between text-sm">
        <span class="text-gray-500">طريقة الدفع</span>
        <span class="font-semibold">{{ sale ? methodLabels[sale.paymentMethod] : '—' }}</span>
      </div>
      <div v-if="sale?.changeDue && sale.changeDue > 0" class="flex justify-between text-sm">
        <span class="text-gray-500">الباقي</span>
        <span class="font-semibold text-green-600">
          {{ sale.amountReceivedCurrency === 'SYP'
              ? `${sale.changeDue.toLocaleString()} ل.س`
              : `$${sale.changeDue.toFixed(2)}` }}
        </span>
      </div>
    </div>

    <button
      type="button"
      :disabled="printer.printing.value"
      class="w-full max-w-sm h-12 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-semibold mb-3 disabled:opacity-50 active:scale-95 transition-all"
      @click="handlePrint"
    >
      {{ printer.printing.value ? 'جارٍ الطباعة...' : 'طباعة الفاتورة' }}
    </button>

    <button
      type="button"
      class="w-full max-w-sm h-12 rounded-xl bg-blue-600 text-white font-semibold mb-3 active:scale-95 transition-all"
      @click="router.push('/pos')"
    >
      بيع جديد
    </button>

    <button
      type="button"
      class="text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 mb-2"
      @click="router.push('/history')"
    >
      آخر المبيعات
    </button>

    <button
      type="button"
      class="text-sm text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
      @click="router.push('/')"
    >
      العودة للرئيسية
    </button>
  </div>

  <AppToast v-if="toast" :message="toast.message" :type="toast.type" @dismiss="toast = null" />
</template>
```

- [ ] **Step 7: Commit**

```bash
git add src/features/payment/payment.types.ts src/features/payment/usePayment.ts src/features/pos/SaleConfirmationScreen.vue src/__tests__/features/usePayment.test.ts
git commit -m "fix(receipt): include line items in CompletedSale, add home link on confirmation"
```

---

## Task 2 — Fix SalePanel: empty text, clear button, swipe-left delete

**Files:**
- Modify: `src/features/pos/SalePanel.vue`

- [ ] **Step 1: Rewrite `SalePanel.vue`**

Replace the entire file with:

```vue
<script setup lang="ts">
import { ref, computed } from 'vue'
import { useSaleStore } from '@/store/sale.store'
import AppDialog from '@/components/ui/AppDialog.vue'

const emit = defineEmits<{ (e: 'pay'): void }>()
const store = useSaleStore()

const totalSyp = computed(() => {
  const rate = store.lockedExchangeRate
  if (rate === null) return null
  return Math.round(store.totalUsd * rate)
})

const showClearDialog  = ref(false)
const swipedProductId  = ref<string | null>(null)
let   touchStartX      = 0

function onTouchStart(e: TouchEvent, productId: string) {
  touchStartX = e.touches[0].clientX
  if (swipedProductId.value !== productId) swipedProductId.value = null
}

function onTouchEnd(e: TouchEvent, productId: string) {
  const dx = touchStartX - e.changedTouches[0].clientX
  if (dx > 50)  swipedProductId.value = productId
  else if (dx < -20) swipedProductId.value = null
}

function handleClearSale() {
  store.clear()
  showClearDialog.value = false
}
</script>

<template>
  <div class="flex flex-col h-full bg-white dark:bg-gray-800 border-t sm:border-t-0 sm:border-r border-gray-200 dark:border-gray-700">
    <!-- Header -->
    <div class="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
      <span class="text-sm font-semibold text-gray-700 dark:text-gray-300">الفاتورة</span>
      <div class="flex items-center gap-3">
        <span class="text-xs text-gray-400">{{ store.lines.length }} صنف</span>
        <button
          v-if="store.lines.length > 0"
          type="button"
          class="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"
          @click="showClearDialog = true"
        >مسح</button>
      </div>
    </div>

    <!-- Line items -->
    <div class="flex-1 overflow-y-auto">
      <div
        v-if="store.lines.length === 0"
        class="flex items-center justify-center h-20 text-gray-400 text-sm"
      >
        لا توجد منتجات في البيع
      </div>

      <div
        v-for="line in store.lines"
        :key="line.productId"
        class="relative overflow-hidden border-b border-gray-100 dark:border-gray-700"
        @touchstart="(e) => onTouchStart(e, line.productId)"
        @touchend="(e) => onTouchEnd(e, line.productId)"
      >
        <!-- Delete button revealed on swipe -->
        <div class="absolute inset-y-0 start-0 w-20 flex items-center justify-center bg-red-600">
          <button
            type="button"
            class="text-white text-sm font-medium w-full h-full"
            @click="store.removeLine(line.productId); swipedProductId = null"
          >حذف</button>
        </div>

        <!-- Row content (slides to reveal delete button) -->
        <div
          :class="swipedProductId === line.productId ? '-translate-x-20' : 'translate-x-0'"
          class="relative flex items-center gap-3 px-4 py-3 bg-white dark:bg-gray-800 transition-transform duration-200"
        >
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-gray-900 dark:text-white truncate">{{ line.nameAr }}</p>
            <p class="text-xs text-gray-400">${{ line.unitPriceUsd.toFixed(2) }}</p>
          </div>

          <div class="flex items-center gap-2">
            <button
              type="button"
              class="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-sm flex items-center justify-center active:scale-90 transition-transform"
              @click="line.quantity - 1 < 1 ? store.removeLine(line.productId) : store.updateQuantity(line.productId, line.quantity - 1)"
            >−</button>
            <span class="text-sm font-semibold w-5 text-center">{{ line.quantity }}</span>
            <button
              type="button"
              class="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-sm flex items-center justify-center active:scale-90 transition-transform"
              @click="store.updateQuantity(line.productId, line.quantity + 1)"
            >+</button>
          </div>

          <span class="text-sm font-semibold text-gray-900 dark:text-white w-16 text-left">
            ${{ line.lineTotalUsd.toFixed(2) }}
          </span>
        </div>
      </div>
    </div>

    <!-- Totals + actions -->
    <div class="px-4 py-3 border-t border-gray-200 dark:border-gray-700">
      <div class="flex justify-between text-sm text-gray-600 dark:text-gray-300 mb-1">
        <span>المجموع (دولار)</span>
        <span class="font-bold text-gray-900 dark:text-white">${{ store.totalUsd.toFixed(2) }}</span>
      </div>
      <div v-if="totalSyp !== null" class="flex justify-between text-xs text-gray-400 mb-3">
        <span>بالليرة (السعر المقفل)</span>
        <span>{{ totalSyp.toLocaleString() }} ل.س</span>
      </div>

      <button
        type="button"
        :disabled="store.lines.length === 0"
        class="w-full h-12 rounded-xl bg-blue-600 text-white font-semibold text-base disabled:opacity-40 disabled:cursor-not-allowed active:scale-95 transition-all"
        @click="emit('pay')"
      >
        دفع
      </button>
    </div>
  </div>

  <AppDialog
    v-if="showClearDialog"
    title="مسح البيع"
    message="متأكد من حذف البيع؟"
    confirm-label="نعم"
    cancel-label="لا"
    :danger="true"
    @confirm="handleClearSale"
    @cancel="showClearDialog = false"
  />
</template>
```

- [ ] **Step 2: Run all tests to verify nothing broke**

```
npx vitest run
```

Expected: all existing tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/features/pos/SalePanel.vue
git commit -m "feat(pos): clear sale button with confirm dialog, swipe-left delete, fix empty state text"
```

---

## Task 3 — Fix PaymentModal: labels, card-confirm state, insufficient amount

**Files:**
- Modify: `src/components/ui/NumericKeypad.vue`
- Modify: `src/features/payment/usePayment.ts`
- Modify: `src/features/payment/PaymentModal.vue`
- Modify: `src/__tests__/features/usePayment.test.ts`

**Note:** `payment.types.ts` already has `'card-confirm'` added in Task 1.

- [ ] **Step 1: Write failing test for card-confirm state**

Update this existing test in `src/__tests__/features/usePayment.test.ts`:

```typescript
it('selectMethod transitions to card-confirm state for card', () => {
  const { state, selectMethod } = usePayment()
  selectMethod('card')
  expect(state.value).toBe('card-confirm')
})
```

(This replaces the old `'selectMethod transitions directly to confirming for card'` test.)

- [ ] **Step 2: Run test to confirm it fails**

```
npx vitest run src/__tests__/features/usePayment.test.ts
```

Expected: FAIL — `state.value` is `'confirming'` but expected `'card-confirm'`.

- [ ] **Step 3: Update `usePayment.ts` — card → card-confirm, fix back()**

In `src/features/payment/usePayment.ts`, replace the `selectMethod` and `back` functions:

```typescript
function selectMethod(m: PaymentMethod) {
  method.value = m
  state.value  = m === 'card' ? 'card-confirm' : 'amount-entry'
}

function back() {
  if (state.value === 'amount-entry' || state.value === 'card-confirm') {
    amountReceived.value = null
    method.value         = null
    state.value          = 'method-selection'
  }
}
```

- [ ] **Step 4: Run test to confirm it passes**

```
npx vitest run src/__tests__/features/usePayment.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Add `confirmDisabled` prop to `NumericKeypad.vue`**

Replace `src/components/ui/NumericKeypad.vue` with:

```vue
<script setup lang="ts">
const props = defineProps<{ confirmDisabled?: boolean }>()
const emit  = defineEmits<{
  (e: 'digit',   d: string): void
  (e: 'delete'):              void
  (e: 'confirm'):             void
}>()

const keys = ['7','8','9','4','5','6','1','2','3','.',  '0', '⌫']
</script>

<template>
  <div class="grid grid-cols-3 gap-2 p-4">
    <button
      v-for="key in keys"
      :key="key"
      type="button"
      :aria-label="key === '⌫' ? 'حذف' : key"
      :class="[
        'flex items-center justify-center h-14 rounded-xl text-xl font-medium',
        'bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-white',
        'active:scale-95 transition-transform',
        key === '⌫' ? 'text-red-500' : '',
      ]"
      @click="key === '⌫' ? emit('delete') : emit('digit', key)"
    >{{ key }}</button>
    <button
      type="button"
      aria-label="تأكيد"
      :disabled="props.confirmDisabled"
      :class="[
        'col-span-3 h-12 rounded-xl bg-blue-600 text-white text-base font-semibold',
        'active:scale-95 transition-transform disabled:opacity-40 disabled:cursor-not-allowed',
      ]"
      @click="emit('confirm')"
    >تأكيد</button>
  </div>
</template>
```

- [ ] **Step 6: Rewrite `PaymentModal.vue`**

Replace `src/features/payment/PaymentModal.vue` with:

```vue
<script setup lang="ts">
import { ref, computed } from 'vue'
import NumericKeypad from '@/components/ui/NumericKeypad.vue'
import { usePayment } from './usePayment'
import type { CompletedSale } from './payment.types'

const emit = defineEmits<{
  (e: 'confirmed', sale: CompletedSale): void
  (e: 'close'):                          void
}>()

const { state, method, amountReceived, totalUsd, totalSyp, changeDue, error,
        selectMethod, back, cancel, confirm } = usePayment()

const amountStr = ref('')

const displayAmount = computed(() => {
  if (!amountStr.value) return null
  return parseFloat(amountStr.value)
})

const amountSufficient = computed(() => {
  const amount = displayAmount.value
  if (amount === null || isNaN(amount)) return false
  if (method.value === 'cash_usd') return amount >= totalUsd.value
  if (method.value === 'cash_syp') return amount >= totalSyp.value
  return false
})

function handleDigit(d: string) {
  if (d === '.' && amountStr.value.includes('.')) return
  amountStr.value += d
  amountReceived.value = displayAmount.value
}

function handleDelete() {
  amountStr.value = amountStr.value.slice(0, -1)
  amountReceived.value = displayAmount.value
}

async function handleConfirm() {
  if (method.value !== 'card' && !amountSufficient.value) return
  try {
    state.value = 'confirming'
    const sale = await confirm()
    emit('confirmed', sale)
  } catch {
    // error is set in usePayment
  }
}

function handleCancel() {
  cancel()
  emit('close')
}
</script>

<template>
  <!-- Backdrop -->
  <div class="fixed inset-0 z-40 bg-black/50" @click="state === 'method-selection' && handleCancel()" />

  <!-- Sheet -->
  <div class="fixed bottom-0 left-0 right-0 sm:inset-0 sm:flex sm:items-center sm:justify-center z-50">
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="payment-modal-title"
      class="bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[90dvh] overflow-y-auto"
    >

      <!-- ── Method selection ── -->
      <div v-if="state === 'method-selection'" class="p-6">
        <div class="flex justify-start mb-4">
          <button type="button" class="text-sm text-blue-600 dark:text-blue-400" @click="handleCancel">
            إلغاء
          </button>
        </div>

        <h2 id="payment-modal-title" class="text-lg font-bold text-gray-900 dark:text-white mb-4 text-center">
          إجمالي البيع
        </h2>

        <div class="mb-6 text-center">
          <p class="text-3xl font-bold text-gray-900 dark:text-white">${{ totalUsd.toFixed(2) }}</p>
          <p class="text-sm text-gray-400 mt-1">{{ totalSyp.toLocaleString() }} ل.س</p>
        </div>

        <div class="grid grid-cols-3 gap-3">
          <button
            v-for="m in [
              { key: 'cash_usd', label: 'نقدي دولار' },
              { key: 'cash_syp', label: 'نقدي ليرة' },
              { key: 'card',     label: 'بطاقة' },
            ]"
            :key="m.key"
            type="button"
            class="py-4 rounded-xl border-2 border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 hover:border-blue-500 hover:text-blue-600 active:scale-95 transition-all"
            @click="selectMethod(m.key as any)"
          >{{ m.label }}</button>
        </div>

        <p v-if="error" class="mt-4 text-red-600 text-sm text-center">{{ error }}</p>
      </div>

      <!-- ── Amount entry (cash) ── -->
      <div v-else-if="state === 'amount-entry'" class="p-6">
        <div class="flex justify-start mb-4">
          <button type="button" class="text-sm text-gray-500 dark:text-gray-400" @click="back">
            رجوع
          </button>
        </div>

        <h2 id="payment-modal-title" class="text-lg font-bold text-gray-900 dark:text-white mb-4 text-center">
          المبلغ المستلم
        </h2>

        <div class="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 mb-2 text-center">
          <p class="text-sm text-gray-500 mb-1">
            {{ method === 'cash_syp' ? 'المجموع بالليرة' : 'المجموع بالدولار' }}
          </p>
          <p class="text-2xl font-bold text-gray-900 dark:text-white">
            {{ method === 'cash_syp' ? `${totalSyp.toLocaleString()} ل.س` : `$${totalUsd.toFixed(2)}` }}
          </p>
        </div>

        <div class="bg-white dark:bg-gray-900 rounded-xl border-2 border-blue-500 p-4 mb-2 text-center">
          <p class="text-3xl font-mono font-bold text-gray-900 dark:text-white">
            {{ amountStr || '0' }}
          </p>
          <p v-if="changeDue !== null && changeDue > 0" class="text-sm text-green-600 dark:text-green-400 mt-1">
            الباقي: {{ method === 'cash_syp' ? `${changeDue.toLocaleString()} ل.س` : `$${changeDue.toFixed(2)}` }}
          </p>
        </div>

        <p
          v-if="amountStr && !amountSufficient"
          class="text-red-600 dark:text-red-400 text-sm text-center mb-2"
        >
          المبلغ غير كافٍ
        </p>

        <NumericKeypad
          :confirm-disabled="!amountSufficient"
          @digit="handleDigit"
          @delete="handleDelete"
          @confirm="handleConfirm"
        />
        <p v-if="error" class="text-red-600 text-sm text-center mt-2">{{ error }}</p>
      </div>

      <!-- ── Card confirm ── -->
      <div v-else-if="state === 'card-confirm'" class="p-6">
        <div class="flex justify-start mb-4">
          <button type="button" class="text-sm text-gray-500 dark:text-gray-400" @click="back">
            رجوع
          </button>
        </div>

        <h2 id="payment-modal-title" class="text-lg font-bold text-gray-900 dark:text-white mb-4 text-center">
          إجمالي البيع
        </h2>

        <div class="mb-6 text-center">
          <p class="text-3xl font-bold text-gray-900 dark:text-white">${{ totalUsd.toFixed(2) }}</p>
          <p class="text-sm text-gray-400 mt-1">{{ totalSyp.toLocaleString() }} ل.س</p>
        </div>

        <div class="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 mb-6 text-center">
          <p class="text-blue-700 dark:text-blue-300 font-medium">💳 بطاقة</p>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">سيتم تسجيل الدفع بالبطاقة</p>
        </div>

        <button
          type="button"
          class="w-full h-12 rounded-xl bg-blue-600 text-white font-semibold active:scale-95 transition-all"
          @click="handleConfirm"
        >
          تأكيد
        </button>
      </div>

      <!-- ── Confirming (spinner) ── -->
      <div v-else-if="state === 'confirming'" class="p-6 flex flex-col items-center gap-4">
        <div class="w-10 h-10 rounded-full border-4 border-blue-600 border-t-transparent animate-spin" />
        <p class="text-gray-600 dark:text-gray-300">جارٍ التأكيد...</p>
      </div>

    </div>
  </div>
</template>
```

- [ ] **Step 7: Run all tests**

```
npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/ui/NumericKeypad.vue src/features/payment/usePayment.ts src/features/payment/PaymentModal.vue src/__tests__/features/usePayment.test.ts
git commit -m "feat(payment): card-confirm state, إلغاء/رجوع labels, insufficient amount guard"
```

---

## Task 4 — ExchangeRateEditor validation message + barcode toast fix

**Files:**
- Modify: `src/features/exchange-rate/ExchangeRateEditor.vue`
- Modify: `src/features/pos/POSSaleScreen.vue`

- [ ] **Step 1: Add validation error to `ExchangeRateEditor.vue`**

In `src/features/exchange-rate/ExchangeRateEditor.vue`, replace the `handleSave` function and add a local `validationError` ref:

```typescript
const validationError = ref<string | null>(null)

async function handleSave() {
  const val = parseFloat(input.value)
  if (isNaN(val) || val <= 0) {
    validationError.value = 'السعر يجب أن يكون أكبر من صفر'
    return
  }
  validationError.value = null
  await saveRate(val)
  if (!needsConfirmation.value && !error.value) {
    emit('saved')
    emit('close')
  }
}
```

Then in the template, replace the existing `<p v-if="error" ...>` with:

```html
<p v-if="validationError" class="text-red-600 text-sm mb-3">{{ validationError }}</p>
<p v-else-if="error"      class="text-red-600 text-sm mb-3">{{ error }}</p>
```

- [ ] **Step 2: Fix barcode unknown toast in `POSSaleScreen.vue`**

In `src/features/pos/POSSaleScreen.vue`, find the barcode scan callback in `onMounted`:

```typescript
scanner.onScan(async (barcode) => {
  const productId = await sale.lookupByBarcode(barcode)
  if (productId) {
    await handleProductTap(productId)
  } else {
    toast.value = { message: `لم يُعثر على باركود: ${barcode}`, type: 'error' }
  }
})
```

Change the toast message to:

```typescript
toast.value = { message: 'الباركود غير معروف', type: 'error' }
```

- [ ] **Step 3: Run all tests**

```
npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/exchange-rate/ExchangeRateEditor.vue src/features/pos/POSSaleScreen.vue
git commit -m "fix(exchange-rate,pos): validation error message, correct unknown barcode toast"
```

---

## Task 5 — USB scanner focus guard

**Files:**
- Modify: `src/composables/useBarcodeScan.ts`
- Modify: `src/__tests__/composables/useBarcodeScan.test.ts`

**Problem:** When a USB scanner fires keystrokes, the current `handleKeyDown` never calls `e.preventDefault()`, so all characters are also typed into any focused input (e.g., the exchange rate editor). The fix: from the 2nd character in a detected burst onward, call `e.preventDefault()`. Also call `e.preventDefault()` on the terminating Enter of a scanner burst.

- [ ] **Step 1: Write failing test**

Add to `src/__tests__/composables/useBarcodeScan.test.ts` (after the existing `describe` block):

```typescript
describe('useBarcodeScan focus guard', () => {
  it('calls e.preventDefault() on burst chars from the 2nd char onward', () => {
    const { onScan, destroy } = useBarcodeScan()
    onScan(() => {})

    const events: (KeyboardEvent & { preventDefault: ReturnType<typeof vi.fn> })[] = []
    const now = 0

    // 8 chars at 10ms each — fast burst
    ;['1','2','3','4','5','6','7','8'].forEach((key, i) => {
      const e = new KeyboardEvent('keydown', { key, cancelable: true })
      Object.defineProperty(e, 'timeStamp', { value: now + i * 10 })
      e.preventDefault = vi.fn()
      events.push(e as any)
      document.dispatchEvent(e)
    })

    // Characters 2-8 (index 1-7) must have preventDefault called
    events.slice(1).forEach(e => {
      expect(e.preventDefault).toHaveBeenCalled()
    })
    // First char is ambiguous — no requirement
    destroy()
  })

  it('calls e.preventDefault() on the terminating Enter of a scanner burst', () => {
    const { onScan, destroy } = useBarcodeScan()
    onScan(() => {})

    const now = 0
    ;['1','2','3','4'].forEach((key, i) => {
      const e = new KeyboardEvent('keydown', { key })
      Object.defineProperty(e, 'timeStamp', { value: now + i * 10 })
      document.dispatchEvent(e)
    })

    const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
    Object.defineProperty(enter, 'timeStamp', { value: now + 4 * 10 })
    enter.preventDefault = vi.fn()
    document.dispatchEvent(enter)

    expect(enter.preventDefault).toHaveBeenCalled()
    destroy()
  })
})
```

- [ ] **Step 2: Run test to confirm it fails**

```
npx vitest run src/__tests__/composables/useBarcodeScan.test.ts
```

Expected: FAIL — `e.preventDefault` not called.

- [ ] **Step 3: Update `useBarcodeScan.ts` with focus guard**

Replace `src/composables/useBarcodeScan.ts` with:

```typescript
import { ref } from 'vue'

const SCANNER_INTERVAL_MS = 33

type ScanCallback = (barcode: string) => void

export function useBarcodeScan() {
  const cameraAvailable = ref(
    typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
  )

  let buffer:    string  = ''
  let lastTime:  number  = 0
  let inBurst:   boolean = false
  let callbacks: ScanCallback[] = []

  function handleKeyDown(e: KeyboardEvent) {
    const now = e.timeStamp

    if (e.key === 'Enter') {
      if (buffer.length >= 4 && inBurst) {
        e.preventDefault()
        callbacks.forEach(cb => cb(buffer))
      }
      buffer   = ''
      lastTime = 0
      inBurst  = false
      return
    }

    if (e.key.length === 1) {
      if (buffer.length === 0) {
        buffer   = e.key
        lastTime = now
        inBurst  = false
      } else {
        const interval = now - lastTime
        if (interval < SCANNER_INTERVAL_MS) {
          inBurst  = true
          e.preventDefault()
          buffer  += e.key
          lastTime = now
        } else {
          // Too slow — new potential sequence
          buffer   = e.key
          lastTime = now
          inBurst  = false
        }
      }
    }
  }

  document.addEventListener('keydown', handleKeyDown)

  function onScan(cb: ScanCallback) {
    callbacks.push(cb)
  }

  function offScan(cb: ScanCallback) {
    callbacks = callbacks.filter(c => c !== cb)
  }

  function destroy() {
    document.removeEventListener('keydown', handleKeyDown)
    callbacks = []
    buffer    = ''
    lastTime  = 0
    inBurst   = false
  }

  async function startCamera(videoEl: HTMLVideoElement, onResult: ScanCallback): Promise<() => void> {
    if (!cameraAvailable.value) throw new Error('Camera not available')
    const { BrowserMultiFormatReader } = await import('@zxing/browser')
    const codeReader = new BrowserMultiFormatReader()
    const controls   = await codeReader.decodeFromVideoDevice(undefined, videoEl, (result) => {
      if (result) onResult(result.getText())
    })
    return () => controls.stop()
  }

  return { cameraAvailable, onScan, offScan, startCamera, destroy }
}
```

- [ ] **Step 4: Run tests**

```
npx vitest run src/__tests__/composables/useBarcodeScan.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/composables/useBarcodeScan.ts src/__tests__/composables/useBarcodeScan.test.ts
git commit -m "feat(scanner): focus guard — preventDefault on burst keystrokes, refactor startCamera"
```

---

## Task 6 — Camera barcode scanning

**Files:**
- Modify: `src/features/pos/POSSaleScreen.vue`

**What:** Add a camera icon to the search bar. Tapping it opens a full-screen camera overlay that uses `@zxing/browser` to scan. On success, the product is looked up and added. Handle permission-denied with a recovery message. Hide the icon on HTTP (where `cameraAvailable` is already `false`).

- [ ] **Step 1: Rewrite `POSSaleScreen.vue`**

Replace `src/features/pos/POSSaleScreen.vue` with:

```vue
<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppToast from '@/components/ui/AppToast.vue'
import ProductGrid from './ProductGrid.vue'
import SalePanel from './SalePanel.vue'
import { useSale } from './useSale'
import { useExchangeRate } from '@/features/exchange-rate'
import { useBarcodeScan } from '@/composables/useBarcodeScan'
import { useSaleDraft } from '@/composables/useSaleDraft'
import PaymentModal from '@/features/payment/PaymentModal.vue'
import type { CompletedSale } from '@/features/payment/payment.types'

const router     = useRouter()
const { currentRate, loadRate } = useExchangeRate()
const sale       = useSale(currentRate)
const { scheduleSave } = useSaleDraft()
const scanner    = useBarcodeScan()

const searchQuery   = ref('')
const payOpen       = ref(false)
const toast         = ref<{ message: string; type: 'error' | 'success' | 'info' } | null>(null)

// Camera state
const cameraOpen    = ref(false)
const cameraError   = ref<'permission-denied' | null>(null)
const videoRef      = ref<HTMLVideoElement | null>(null)
let   stopCamera: (() => void) | null = null

onMounted(async () => {
  await loadRate()
  scanner.onScan(async (barcode) => {
    const productId = await sale.lookupByBarcode(barcode)
    if (productId) {
      await handleProductTap(productId)
    } else {
      toast.value = { message: 'الباركود غير معروف', type: 'error' }
    }
  })
})

async function handleProductTap(productId: string) {
  try {
    await sale.addLine(productId)
    scheduleSave()
  } catch (err) {
    toast.value = {
      message: err instanceof Error ? err.message : 'خطأ في الإضافة',
      type: 'error',
    }
  }
}

async function openCamera() {
  cameraOpen.value  = true
  cameraError.value = null
  await nextTick()
  try {
    stopCamera = await scanner.startCamera(videoRef.value!, async (barcode) => {
      closeCamera()
      const productId = await sale.lookupByBarcode(barcode)
      if (productId) {
        await handleProductTap(productId)
      } else {
        toast.value = { message: 'الباركود غير معروف', type: 'error' }
      }
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      cameraError.value = 'permission-denied'
    } else {
      cameraOpen.value = false
    }
  }
}

function closeCamera() {
  stopCamera?.()
  stopCamera        = null
  cameraOpen.value  = false
  cameraError.value = null
}

function handlePaymentConfirmed(completedSale: CompletedSale) {
  payOpen.value = false
  router.push({ path: '/pos/confirmation', state: { sale: completedSale } })
}
</script>

<template>
  <div class="flex flex-col min-h-dvh">
    <AppHeader title="بيع جديد" :show-exchange-rate="true" :show-back="true" @back="router.push('/')" />

    <!-- Rate change notice -->
    <div
      v-if="sale.hasRateChangeNotice.value"
      class="bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300 text-sm px-4 py-2 border-b border-orange-200"
    >
      تغيّر سعر الصرف — سيُطبق السعر الجديد على البيع التالي فقط
    </div>

    <!-- Phone: stacked. Tablet: side-by-side -->
    <div class="flex-1 flex flex-col sm:flex-row overflow-hidden">
      <!-- Product area (60%) -->
      <div class="flex flex-col sm:flex-[60]">
        <!-- Search bar with optional camera icon -->
        <div class="px-3 py-2 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
          <div class="relative flex-1">
            <input
              v-model="searchQuery"
              type="search"
              placeholder="ابحث عن منتج أو باركود..."
              class="w-full h-10 px-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500"
              dir="rtl"
            />
          </div>
          <button
            v-if="scanner.cameraAvailable.value"
            type="button"
            aria-label="مسح بالكاميرا"
            class="w-10 h-10 flex items-center justify-center rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-500 hover:text-blue-600 hover:border-blue-400 transition-colors"
            @click="openCamera"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
        <div class="flex-1 overflow-y-auto">
          <ProductGrid :search-query="searchQuery" @product-tap="handleProductTap" />
        </div>
      </div>

      <!-- Sale panel (40%) -->
      <div class="sm:flex-[40] min-h-[40vh] sm:min-h-0">
        <SalePanel @pay="payOpen = true" />
      </div>
    </div>
  </div>

  <!-- Camera overlay -->
  <div v-if="cameraOpen" class="fixed inset-0 z-50 bg-black flex flex-col">
    <!-- Permission denied state -->
    <div v-if="cameraError === 'permission-denied'" class="flex-1 flex flex-col items-center justify-center gap-4 px-6">
      <p class="text-white text-center text-sm">
        يجب السماح للكاميرا في إعدادات المتصفح
      </p>
      <button
        type="button"
        class="px-6 py-3 bg-blue-600 rounded-xl text-white text-sm font-medium"
        @click="openCamera"
      >
        حاول مرة أخرى
      </button>
    </div>

    <!-- Live camera view -->
    <template v-else>
      <video ref="videoRef" class="flex-1 object-cover w-full" autoplay playsinline muted />
    </template>

    <button
      type="button"
      class="py-5 text-white text-center text-sm bg-black/60"
      @click="closeCamera"
    >
      إلغاء
    </button>
  </div>

  <PaymentModal
    v-if="payOpen"
    @confirmed="handlePaymentConfirmed"
    @close="payOpen = false"
  />

  <AppToast
    v-if="toast"
    :message="toast.message"
    :type="toast.type"
    @dismiss="toast = null"
  />
</template>
```

- [ ] **Step 2: Run all tests**

```
npx vitest run
```

Expected: all tests PASS (camera logic is integration-only, no unit tests needed).

- [ ] **Step 3: Commit**

```bash
git add src/features/pos/POSSaleScreen.vue
git commit -m "feat(pos): camera barcode scan — icon, overlay, permission-denied recovery"
```

---

## Task 7 — Tappable SyncIndicator with detail panel

**Files:**
- Modify: `src/features/sync/useSync.ts`
- Modify: `src/features/sync/SyncIndicator.vue`

**What:** The spec requires tapping the sync indicator to open a panel showing: last sync time, pending count, and a "مزامنة الآن" (Sync now) button. `useSync` gains a `syncNow()` action.

- [ ] **Step 1: Add `syncNow()` to `useSync.ts`**

Replace `src/features/sync/useSync.ts` with:

```typescript
import { computed, onMounted, onUnmounted } from 'vue'
import { useSyncStore } from '@/store/sync.store'
import { db } from '@/data/powersync/db'
import { SupabaseConnector } from '@/data/powersync/connector'

export function useSync() {
  const syncStore = useSyncStore()

  const isStale = computed(() => {
    if (!syncStore.lastSyncedAt) return false
    return Date.now() - syncStore.lastSyncedAt.getTime() > 24 * 60 * 60 * 1000
  })

  function bindPowerSync() {
    const unsubscribe = db.status?.onChange?.((status: any) => {
      if (status.connected) {
        syncStore.setStatus('online')
        syncStore.setLastSynced(new Date())
      } else if (status.dataFlowStatus?.downloading || status.dataFlowStatus?.uploading) {
        syncStore.setStatus('syncing')
      } else {
        syncStore.setStatus('offline')
      }
    })
    return unsubscribe
  }

  async function syncNow() {
    try {
      syncStore.setStatus('syncing')
      await db.connect(new SupabaseConnector())
    } catch {
      // PowerSync will retry automatically; status events update the store
    }
  }

  let unbind: (() => void) | undefined

  onMounted(() => { unbind = bindPowerSync() })
  onUnmounted(() => { unbind?.() })

  return {
    status:       computed(() => syncStore.status),
    pendingCount: computed(() => syncStore.pendingCount),
    lastSyncedAt: computed(() => syncStore.lastSyncedAt),
    errorMessage: computed(() => syncStore.errorMessage),
    isStale,
    syncNow,
  }
}
```

- [ ] **Step 2: Rewrite `SyncIndicator.vue` with tappable detail panel**

Replace `src/features/sync/SyncIndicator.vue` with:

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { useSync } from './useSync'
import SyncBadge from '@/components/ui/SyncBadge.vue'

const { status, pendingCount, lastSyncedAt, isStale, errorMessage, syncNow } = useSync()

const panelOpen    = ref(false)
const syncing      = ref(false)

function formatLastSync(d: Date | null): string {
  if (!d) return 'لم تتم المزامنة بعد'
  return new Intl.DateTimeFormat('ar-SY', {
    hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short',
  }).format(d)
}

async function handleSyncNow() {
  syncing.value = true
  try {
    await syncNow()
  } finally {
    syncing.value = false
  }
}
</script>

<template>
  <!-- Tappable badge -->
  <button
    type="button"
    class="flex flex-col items-end focus:outline-none"
    @click="panelOpen = !panelOpen"
  >
    <SyncBadge :status="status" :pending-count="pendingCount" />
    <p v-if="isStale" role="alert" class="text-xs text-orange-500 mt-0.5">لم تتم المزامنة منذ 24 ساعة</p>
    <p v-if="errorMessage" role="alert" class="text-xs text-red-500 mt-0.5 max-w-xs truncate">{{ errorMessage }}</p>
  </button>

  <!-- Detail panel (inline dropdown) -->
  <div
    v-if="panelOpen"
    class="absolute top-14 start-0 end-0 z-40 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 shadow-md px-4 py-4 text-right"
  >
    <div class="max-w-lg mx-auto space-y-3">
      <div class="flex justify-between text-sm">
        <span class="text-gray-500 dark:text-gray-400">آخر مزامنة</span>
        <span class="text-gray-900 dark:text-white">{{ formatLastSync(lastSyncedAt) }}</span>
      </div>

      <div v-if="(pendingCount ?? 0) > 0" class="flex justify-between text-sm">
        <span class="text-gray-500 dark:text-gray-400">في الانتظار</span>
        <span class="text-orange-600 font-medium">{{ pendingCount }} معاملة</span>
      </div>

      <div v-if="errorMessage" class="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg p-2">
        {{ errorMessage }}
      </div>

      <div class="flex gap-2 pt-1">
        <button
          type="button"
          :disabled="syncing || status === 'syncing'"
          class="flex-1 h-9 rounded-lg bg-blue-600 text-white text-sm font-medium disabled:opacity-50"
          @click="handleSyncNow"
        >
          {{ syncing || status === 'syncing' ? 'جارٍ المزامنة...' : 'مزامنة الآن' }}
        </button>
        <button
          type="button"
          class="h-9 px-4 rounded-lg border border-gray-300 dark:border-gray-600 text-sm text-gray-600 dark:text-gray-300"
          @click="panelOpen = false"
        >
          إغلاق
        </button>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 3: Run all tests**

```
npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/sync/useSync.ts src/features/sync/SyncIndicator.vue
git commit -m "feat(sync): tappable sync indicator with detail panel and manual sync button"
```

---

## Self-Review

**Spec coverage check:**

| Gap | Task | ✓ |
|-----|------|---|
| Receipt missing line items | Task 1 | ✓ |
| Wrong barcode toast | Task 4 | ✓ |
| No "مسح" clear button | Task 2 | ✓ |
| Swipe-left delete | Task 2 | ✓ |
| Wrong empty state text | Task 2 | ✓ |
| Card payment intermediate screen | Task 3 | ✓ |
| "المبلغ غير كافٍ" + disabled confirm | Task 3 | ✓ |
| Wrong إلغاء / رجوع labels | Task 3 | ✓ |
| "العودة للرئيسية" link | Task 1 | ✓ |
| Rate ≤ 0 validation message | Task 4 | ✓ |
| Camera barcode scanning | Task 6 | ✓ |
| USB scanner focus guard | Task 5 | ✓ |
| Tappable sync detail panel | Task 7 | ✓ |

**Type consistency check:**
- `CompletedSale.lines` is `SaleLine[]` — defined in `payment.types.ts` Task 1, populated in `usePayment.ts` Task 1, consumed in `SaleConfirmationScreen.vue` Task 1. Consistent.
- `PaymentState` gains `'card-confirm'` in Task 1 types, used in `usePayment.ts` Task 3, tested in Task 3. Consistent.
- `NumericKeypad` gains `confirmDisabled` prop in Task 3 — used in `PaymentModal.vue` Task 3. Consistent.
- `startCamera(videoEl, onResult)` new signature in Task 5, consumed in `POSSaleScreen.vue` Task 6. Consistent.
- `syncNow()` added to `useSync.ts` Task 7, consumed in `SyncIndicator.vue` Task 7. Consistent.

**No placeholders** — all steps contain complete code.
