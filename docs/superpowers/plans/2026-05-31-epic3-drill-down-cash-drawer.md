# Epic 3 — Drill-Down Screens & Cash Drawer: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add period-aware drill-downs for the three metric cards (sales list, expense list, profit breakdown), a cash drawer indicator on the home screen, and full responsiveness across phone/desktop.

**Architecture:** Extend `useSaleHistory` + `SaleHistoryScreen` with optional date-range filtering; add `ExpenseListPage` using the existing `useExpenses`; add `ProfitSheet` bottom sheet (read-only display from existing `useDashboardMetrics`); add `useCashDrawer` + `CashDrawerBar` + `CashDrawerSheet`; add `tap` emit to `MetricCard` and wire everything in `HomePage`.

**Tech Stack:** Vue 3 + TypeScript + Tailwind, PowerSync (`db.getAll`), Vitest + `@vue/test-utils`, existing `usePeriodToggle` singleton, existing `getDateRange` utility.

---

## File Map

**Modify:**
- `src/features/sale-history/useSaleHistory.ts` — add optional `dateRange` param to `loadHistory()`
- `src/features/sale-history/SaleHistoryScreen.vue` — read `?period=` query param, show period toggle + total
- `src/features/dashboard/components/MetricCard.vue` — add `tap` emit; stop warning-badge click propagation
- `src/router/index.ts` — add `/expenses` route
- `src/pages/HomePage.vue` — wire card taps, add ProfitSheet + CashDrawerBar

**Create:**
- `src/features/expenses/ExpenseListPage.vue` — list expenses for period; tap → ExpenseForm pre-filled
- `src/features/dashboard/components/ProfitSheet.vue` — bottom sheet: 5-row profit breakdown
- `src/features/dashboard/composables/useCashDrawer.ts` — cash totals + movements since day start
- `src/features/dashboard/components/CashDrawerBar.vue` — summary row on home screen
- `src/features/dashboard/components/CashDrawerSheet.vue` — detail bottom sheet with movements
- `src/__tests__/features/useCashDrawer.test.ts`
- `src/__tests__/features/ProfitSheet.test.ts`

---

## Task 1: Extend useSaleHistory + SaleHistoryScreen for period filtering

**Files:**
- Modify: `src/features/sale-history/useSaleHistory.ts`
- Modify: `src/features/sale-history/SaleHistoryScreen.vue`

- [ ] **Step 1: Update useSaleHistory to accept optional date range**

In `src/features/sale-history/useSaleHistory.ts`, change the `loadHistory` signature and query:

```ts
import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { usePrinter } from '@/composables/usePrinter'
import type { ReceiptData } from '@/composables/usePrinter'
import type { SaleRecord, SaleLineRecord } from './sale-history.types'

export function useSaleHistory() {
  const sales   = ref<SaleRecord[]>([])
  const loading = ref(false)
  const error   = ref<string | null>(null)
  const printer = usePrinter()

  async function loadHistory(dateRange?: { start: string; end: string }) {
    const device = useDeviceStore()
    loading.value = true
    error.value   = null
    try {
      let query: string
      let params: string[]

      if (dateRange) {
        // Period-based filter using local date (YYYY-MM-DD)
        query  = `SELECT * FROM sales WHERE shop_id = ? AND DATE(created_at, 'localtime') BETWEEN ? AND ? ORDER BY created_at DESC`
        params = [device.shopId, dateRange.start, dateRange.end]
      } else {
        // Default: last 7 days
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        query  = `SELECT * FROM sales WHERE shop_id = ? AND created_at >= ? ORDER BY created_at DESC`
        params = [device.shopId, sevenDaysAgo]
      }

      const [result, crudResult] = await Promise.all([
        db.execute(query, params),
        db.execute(
          `SELECT DISTINCT json_extract(data, '$.id') as sale_id FROM ps_crud WHERE "table" = 'sales'`
        ).catch(() => ({ rows: { _array: [] } })),
      ])
      const pendingIds = new Set<string>(
        ((crudResult as any).rows._array as any[]).map((r: any) => r.sale_id).filter(Boolean)
      )
      sales.value = ((result as any).rows._array as any[]).map(r => ({
        id:                  r.id,
        shopId:              r.shop_id,
        deviceId:            r.device_id,
        deviceSequence:      r.device_sequence,
        displaySaleNumber:   r.display_sale_number,
        createdAt:           r.created_at,
        totalUsd:            r.total_usd,
        totalSyp:            r.total_syp,
        exchangeRateAtSale:  r.exchange_rate_at_sale,
        paymentMethod:       r.payment_method,
        amountReceived:      r.amount_received,
        amountReceivedCurrency: r.amount_received_currency,
        changeDue:           r.change_due,
        isPending:           pendingIds.has(r.id),
      }))
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  async function reprint(saleId: string): Promise<void> {
    const device = useDeviceStore()
    const [saleRes, linesRes] = await Promise.all([
      db.execute(`SELECT * FROM sales WHERE id = ?`, [saleId]),
      db.execute(`SELECT sli.*, p.name_ar FROM sale_line_items sli JOIN products p ON sli.product_id = p.id WHERE sli.sale_id = ?`, [saleId]),
    ])
    const sale  = ((saleRes as any).rows._array as any[])[0]
    const lines = (linesRes as any).rows._array as any[]
    if (!sale) throw new Error('Sale not found')

    const receipt: ReceiptData = {
      saleId:            sale.id,
      displaySaleNumber: sale.display_sale_number,
      shopName:          device.shopId,
      createdAt:         sale.created_at,
      lines: lines.map((l: any) => ({
        nameAr:       l.name_ar,
        quantity:     l.quantity,
        unitPriceUsd: l.unit_price_usd,
        lineTotalUsd: l.line_total_usd,
      })),
      totalUsd:       sale.total_usd,
      totalSyp:       sale.total_syp,
      exchangeRate:   sale.exchange_rate_at_sale,
      paymentMethod:  sale.payment_method,
      amountReceived: sale.amount_received,
      amountReceivedCurrency: sale.amount_received_currency,
      changeDue:      sale.change_due,
    }
    await printer.print(receipt)
  }

  return { sales, loading, error, loadHistory, reprint, reprintError: printer.error }
}
```

- [ ] **Step 2: Update SaleHistoryScreen to read period query param**

In `src/features/sale-history/SaleHistoryScreen.vue`, add period-awareness. Replace the `<script setup>` block:

```vue
<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppToast from '@/components/ui/AppToast.vue'
import PeriodToggle from '@/features/dashboard/components/PeriodToggle.vue'
import { useSaleHistory } from './useSaleHistory'
import { usePeriodToggle } from '@/features/dashboard/composables/usePeriodToggle'
import { getDateRange } from '@/features/dashboard/composables/periodUtils'

const router  = useRouter()
const route   = useRoute()
const { sales, loading, loadHistory, reprint, reprintError } = useSaleHistory()
const { period } = usePeriodToggle()
const expandedId = ref<string | null>(null)
const toast      = ref<string | null>(null)
const toastType  = ref<'info' | 'error'>('info')

// If ?period= is in the URL, use that period; otherwise use the current singleton value
const isPeriodDrillDown = computed(() => !!route.query.period)

const periodTitle = computed(() => {
  const labels: Record<string, string> = { today: 'اليوم', week: 'الأسبوع', month: 'الشهر' }
  return isPeriodDrillDown.value ? `مبيعات ${labels[period.value] ?? ''}` : 'آخر المبيعات'
})

const periodTotal = computed(() =>
  sales.value.reduce((sum, s) => sum + s.totalUsd, 0)
)

onMounted(async () => {
  if (route.query.period) {
    // Sync singleton to URL param (handles direct navigation)
    const { setPeriod } = usePeriodToggle()
    const p = route.query.period as string
    if (p === 'today' || p === 'week' || p === 'month') setPeriod(p)
  }
  await loadHistory(getDateRange(period.value))
})

// Reload when period changes (user taps toggle)
watch(period, async (newPeriod) => {
  await loadHistory(getDateRange(newPeriod))
})

function formatDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1)  return 'الآن'
  if (diffMin < 60) return `قبل ${diffMin} دقيقة`
  if (diffMin < 24 * 60) return `قبل ${Math.floor(diffMin / 60)} ساعة`
  return new Intl.DateTimeFormat('ar-SY', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d)
}

const methodLabel: Record<string, string> = {
  cash_usd: '💵', cash_syp: 'ل.س', card: '💳',
}

async function handleReprint(saleId: string) {
  try {
    await reprint(saleId)
    toastType.value = 'info'
    toast.value = 'تم إرسال الفاتورة للطباعة'
  } catch (e) {
    toastType.value = 'error'
    toast.value = `خطأ: ${e instanceof Error ? e.message : String(e)}`
  }
}
</script>
```

In the `<template>`, update the `AppHeader` and add period toggle + total row after the header:

Replace the existing `<AppHeader ...>` line with:
```html
<AppHeader
  :title="periodTitle"
  :show-back="true"
  @back="router.push('/')"
/>
```

And directly after `<AppHeader ...>` (before `<main>`), add the period toggle and total (only when in drill-down mode):
```html
<div v-if="isPeriodDrillDown" class="px-4 pt-3 max-w-lg mx-auto w-full space-y-2">
  <PeriodToggle />
  <div v-if="sales.length > 0" class="text-sm font-bold text-blue-600 dark:text-blue-400 text-left">
    إجمالي: ${{ periodTotal.toFixed(2) }}
  </div>
</div>
```

Also update the empty state message to be period-aware:
```html
<p class="font-display italic text-text-muted text-lg">
  {{ isPeriodDrillDown ? 'لا توجد مبيعات في هذه الفترة' : 'لا توجد مبيعات في آخر 7 أيام' }}
</p>
```

Note: `AppHeader` in this codebase may not support a `#right` slot — if it doesn't, place the total as a separate element next to the title. Check `src/components/ui/AppHeader.vue` and adapt accordingly. If no slot is available, add the total inside the main content area below the period toggle.

- [ ] **Step 3: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/features/sale-history/useSaleHistory.ts src/features/sale-history/SaleHistoryScreen.vue
git commit -m "feat(history): extend sale history with period-based date range filtering"
```

---

## Task 2: ExpenseListPage + /expenses route

**Files:**
- Create: `src/features/expenses/ExpenseListPage.vue`
- Modify: `src/router/index.ts`

- [ ] **Step 1: Add /expenses route to router**

In `src/router/index.ts`, add after the `/products/:id/edit` route:

```ts
{ path: '/expenses', component: () => import('@/features/expenses/ExpenseListPage.vue') },
```

- [ ] **Step 2: Create ExpenseListPage.vue**

Create `src/features/expenses/ExpenseListPage.vue`:

```vue
<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppToast from '@/components/ui/AppToast.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import PeriodToggle from '@/features/dashboard/components/PeriodToggle.vue'
import ExpenseForm from './components/ExpenseForm.vue'
import { useExpenses } from './composables/useExpenses'
import { usePeriodToggle } from '@/features/dashboard/composables/usePeriodToggle'
import { getDateRange } from '@/features/dashboard/composables/periodUtils'
import type { Expense } from './expense.types'

const router = useRouter()
const { expenses, load, deleteExpense } = useExpenses()
const { period } = usePeriodToggle()

const editingExpense = ref<Expense | null>(null)
const deleteTarget   = ref<string | null>(null)
const toast          = ref<{ message: string; type: 'success' | 'error' } | null>(null)
const loading        = ref(false)

const periodTitle = computed(() => {
  const labels: Record<string, string> = { today: 'اليوم', week: 'الأسبوع', month: 'الشهر' }
  return `مصاريف ${labels[period.value] ?? ''}`
})

const periodTotal = computed(() =>
  expenses.value.reduce((sum, e) => sum + e.amountUsd, 0)
)

async function reload() {
  loading.value = true
  try {
    const { start, end } = getDateRange(period.value)
    await load(start, end)
  } finally {
    loading.value = false
  }
}

onMounted(reload)
watch(period, reload)

function formatDate(iso: string): string {
  const d = new Date(iso)
  return new Intl.DateTimeFormat('ar-SY', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d)
}

async function confirmDelete() {
  if (!deleteTarget.value) return
  try {
    await deleteExpense(deleteTarget.value)
    deleteTarget.value = null
    toast.value = { message: 'تم حذف المصروف', type: 'success' }
    await reload()
  } catch {
    toast.value = { message: 'فشل الحذف', type: 'error' }
  }
}

function handleExpenseSaved() {
  editingExpense.value = null
  toast.value = { message: 'تم حفظ المصروف', type: 'success' }
  reload()
}
</script>

<template>
  <div class="flex flex-col min-h-dvh bg-gray-50 dark:bg-gray-950" dir="rtl">
    <AppHeader
      :title="periodTitle"
      :show-back="true"
      :show-back-office="false"
      @back="router.push('/')"
    />

    <!-- Period toggle -->
    <div class="px-4 pt-3 pb-2 max-w-2xl mx-auto w-full">
      <PeriodToggle />
    </div>

    <main class="flex-1 px-4 pb-6 max-w-2xl mx-auto w-full">

      <!-- Period total -->
      <div v-if="expenses.length > 0" class="text-sm font-semibold text-orange-500 dark:text-orange-400 mb-3 text-left">
        إجمالي: ${{ periodTotal.toFixed(2) }}
      </div>

      <!-- Loading -->
      <div v-if="loading" class="flex justify-center py-10">
        <div class="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin border-orange-400" />
      </div>

      <!-- Empty state -->
      <div v-else-if="expenses.length === 0" class="flex flex-col items-center justify-center py-16 gap-2 text-gray-400">
        <span class="text-4xl">💰</span>
        <p class="text-sm">لا توجد مصاريف في هذه الفترة</p>
      </div>

      <!-- Expense list — phone cards -->
      <div v-else class="flex flex-col gap-3 sm:hidden">
        <div
          v-for="e in expenses"
          :key="e.id"
          :data-testid="`expense-row-${e.id}`"
          class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4 flex items-center gap-3 cursor-pointer active:scale-[0.98] transition-transform"
          @click="editingExpense = e"
        >
          <div class="flex-1">
            <div class="flex justify-between items-center mb-1">
              <span class="text-base font-bold text-gray-900 dark:text-white">${{ e.amountUsd.toFixed(2) }}</span>
              <span class="text-xs text-gray-400">{{ formatDate(e.createdAt) }}</span>
            </div>
            <div class="text-sm text-gray-500 dark:text-gray-400">{{ e.category }}</div>
            <div v-if="e.notes" class="text-xs text-gray-400 truncate mt-0.5">{{ e.notes }}</div>
          </div>
          <div v-if="e.photoUrl" class="w-10 h-10 rounded-lg overflow-hidden bg-gray-100 shrink-0">
            <img :src="e.photoUrl" :alt="e.category" class="w-full h-full object-cover" />
          </div>
        </div>
      </div>

      <!-- Expense table — desktop -->
      <div class="hidden sm:block overflow-x-auto">
        <table class="w-full text-sm text-right">
          <thead>
            <tr class="border-b border-gray-200 dark:border-gray-700 text-xs text-gray-500">
              <th class="py-3 px-2 font-medium">التاريخ</th>
              <th class="py-3 px-2 font-medium">الفئة</th>
              <th class="py-3 px-2 font-medium">المبلغ</th>
              <th class="py-3 px-2 font-medium">ملاحظات</th>
              <th class="py-3 px-2"></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="e in expenses"
              :key="e.id"
              :data-testid="`expense-row-${e.id}`"
              class="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer"
              @click="editingExpense = e"
            >
              <td class="py-3 px-2 text-gray-500">{{ formatDate(e.createdAt) }}</td>
              <td class="py-3 px-2 font-medium text-gray-900 dark:text-white">{{ e.category }}</td>
              <td class="py-3 px-2 font-semibold text-orange-500">${{ e.amountUsd.toFixed(2) }}</td>
              <td class="py-3 px-2 text-gray-400 truncate max-w-xs">{{ e.notes ?? '—' }}</td>
              <td class="py-3 px-2">
                <button
                  type="button"
                  class="text-xs text-gray-400 hover:text-red-500 px-2 py-1"
                  @click.stop="deleteTarget = e.id"
                >حذف</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

    </main>

    <!-- Delete confirmation -->
    <AppDialog
      v-if="deleteTarget"
      title="حذف المصروف"
      message="هل أنت متأكد من حذف هذا المصروف؟"
      confirm-label="حذف"
      cancel-label="إلغاء"
      @confirm="confirmDelete"
      @cancel="deleteTarget = null"
    />

    <!-- Edit expense via existing form (pre-filled) -->
    <ExpenseForm
      v-if="editingExpense"
      :initial-expense="editingExpense"
      @saved="handleExpenseSaved"
      @cancel="editingExpense = null"
    />

    <AppToast v-if="toast" :message="toast.message" :type="toast.type" @dismiss="toast = null" />
  </div>
</template>
```

**Important note on ExpenseForm:** The existing `ExpenseForm.vue` does not have an `initialExpense` prop — it was built for add-only. You need to add this prop to `ExpenseForm.vue`:

In `src/features/expenses/components/ExpenseForm.vue`, add to `defineProps`:
```ts
const props = defineProps<{ initialExpense?: Expense }>()
```

And initialize form fields from `initialExpense` if present:
```ts
const amount      = ref<number | ''>(props.initialExpense?.amount ?? '')
const currency    = ref<'USD' | 'SYP'>(props.initialExpense?.currency ?? 'USD')
const category    = ref(props.initialExpense?.category ?? '')
const expenseDate = ref(props.initialExpense?.expenseDate ?? new Date().toISOString().slice(0, 10))
const notes       = ref(props.initialExpense?.notes ?? '')
```

And in `handleSave`, if `initialExpense` exists, call `useExpenses().deleteExpense(initialExpense.id)` first then `save(data)` (replace the record — expenses have no UPDATE query, only INSERT/DELETE):

Actually, simpler: when `initialExpense` is present, treat it as an edit by deleting the old record before inserting the new one inside `handleSave`:

```ts
async function handleSave(addAnother = false) {
  if (!validate()) return
  saving.value = true
  try {
    // ...build data...
    if (props.initialExpense) {
      // Edit: delete old record then insert new
      await useExpenses().deleteExpense(props.initialExpense.id)
    }
    await save(data)
    // ...rest...
  } finally {
    saving.value = false
  }
}
```

Also add this import to `src/features/expenses/components/ExpenseForm.vue` at the top of the imports:
```ts
import type { Expense } from '@/features/expenses/expense.types'
```

- [ ] **Step 3: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/features/expenses/ExpenseListPage.vue src/features/expenses/components/ExpenseForm.vue src/router/index.ts
git commit -m "feat(expenses): add ExpenseListPage with period filter and edit-via-form"
```

---

## Task 3: MetricCard tap emit + HomePage card wiring

**Files:**
- Modify: `src/features/dashboard/components/MetricCard.vue`
- Modify: `src/pages/HomePage.vue`

- [ ] **Step 1: Add tap emit to MetricCard**

Replace `src/features/dashboard/components/MetricCard.vue` with:

```vue
<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  label:         string
  amountUsd:     number
  syp:           number
  accent:        'blue' | 'orange' | 'green' | 'red' | 'gray'
  warningCount?: number
}>()

const emit = defineEmits<{
  (e: 'warning-tap'): void
  (e: 'tap'):         void
}>()

const accentClass = computed(() => ({
  blue:   'text-blue-600 dark:text-blue-400',
  orange: 'text-orange-500 dark:text-orange-400',
  green:  'text-green-600 dark:text-green-400',
  red:    'text-red-600 dark:text-red-400',
  gray:   'text-gray-500 dark:text-gray-400',
}[props.accent]))

const formattedUsd = computed(() => {
  const abs = Math.abs(props.amountUsd).toFixed(2)
  if (props.amountUsd > 0)  return `+$${abs}`
  if (props.amountUsd < 0)  return `−$${abs}`
  return `$${abs}`
})

const formattedSyp = computed(() =>
  Math.round(props.syp).toLocaleString('en-US')
)

const showWarning = computed(() => (props.warningCount ?? 0) > 0)
</script>

<template>
  <div
    class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4 flex items-start justify-between
           cursor-pointer active:scale-[0.98] transition-transform select-none"
    dir="rtl"
    role="button"
    tabindex="0"
    data-testid="metric-card"
    @click="emit('tap')"
    @keydown.enter="emit('tap')"
  >
    <div>
      <p class="text-xs text-gray-500 dark:text-gray-400 mb-1">{{ label }}</p>
      <p
        data-testid="amount-usd"
        class="text-2xl font-bold"
        :class="accentClass"
      >{{ formattedUsd }}</p>
      <p
        data-testid="amount-syp"
        class="text-xs text-gray-400 dark:text-gray-500 mt-0.5"
      >{{ formattedSyp }} ل.س</p>
    </div>

    <button
      v-if="showWarning"
      type="button"
      data-testid="warning-badge"
      class="bg-amber-50 dark:bg-amber-900/20 border border-amber-300 dark:border-amber-700
             rounded-lg px-2 py-1 text-xs text-amber-700 dark:text-amber-300 shrink-0"
      @click.stop="emit('warning-tap')"
    >⚠ {{ warningCount }}</button>
  </div>
</template>
```

- [ ] **Step 2: Wire card taps in HomePage.vue**

In `src/pages/HomePage.vue`, add the `useRouter` navigation handlers and a `showProfitSheet` ref. In `<script setup>`, add:

```ts
const showProfitSheet = ref(false)
```

Then update the three `MetricCard` usages in the template to add `@tap` handlers:

```html
<MetricCard
  label="المال الداخل"
  :amount-usd="metrics.revenueUsd.value"
  :syp="revenueSyp"
  accent="blue"
  data-testid="card-revenue"
  @tap="router.push(`/history?period=${period.value}`)"
/>
<MetricCard
  label="المصاريف"
  :amount-usd="metrics.expensesUsd.value"
  :syp="expensesSyp"
  accent="orange"
  data-testid="card-expenses"
  @tap="router.push(`/expenses?period=${period.value}`)"
/>
<MetricCard
  label="الربح"
  :amount-usd="metrics.profitUsd.value"
  :syp="profitSyp"
  :accent="profitAccent"
  :warning-count="metrics.missingCostCount.value"
  data-testid="card-profit"
  @tap="showProfitSheet = true"
  @warning-tap="router.push('/products?filter=missing-cost')"
/>
```

- [ ] **Step 3: Verify TypeScript and tests**

Run: `npx tsc --noEmit && npm test`
Expected: no errors, all tests pass

- [ ] **Step 4: Commit**

```bash
git add src/features/dashboard/components/MetricCard.vue src/pages/HomePage.vue
git commit -m "feat(dashboard): add tap emit to MetricCard, wire card navigation in HomePage"
```

---

## Task 4: ProfitSheet component

**Files:**
- Create: `src/features/dashboard/components/ProfitSheet.vue`
- Create: `src/__tests__/features/ProfitSheet.test.ts`
- Modify: `src/pages/HomePage.vue` (import + add to template)

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/features/ProfitSheet.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ProfitSheet from '@/features/dashboard/components/ProfitSheet.vue'

function mountSheet(props = {}) {
  return mount(ProfitSheet, {
    props: {
      isOpen: true,
      revenueUsd: 450,
      cogsUsd: 236,
      expensesUsd: 80,
      profitUsd: 134,
      period: 'today' as const,
      ...props,
    },
    attachTo: document.body,
  })
}

describe('ProfitSheet', () => {
  it('shows all 5 rows with correct values', () => {
    const w = mountSheet()
    expect(w.find('[data-testid="row-revenue"]').text()).toContain('450')
    expect(w.find('[data-testid="row-cogs"]').text()).toContain('236')
    expect(w.find('[data-testid="row-gross"]').text()).toContain('214') // 450 - 236
    expect(w.find('[data-testid="row-expenses"]').text()).toContain('80')
    expect(w.find('[data-testid="row-net"]').text()).toContain('134')
  })

  it('shows net profit in green when positive', () => {
    const w = mountSheet({ profitUsd: 134 })
    expect(w.find('[data-testid="row-net"]').classes()).toContain('text-green-600')
  })

  it('shows net profit in red when negative', () => {
    const w = mountSheet({ profitUsd: -50, cogsUsd: 0, expensesUsd: 500, revenueUsd: 450 })
    expect(w.find('[data-testid="row-net"]').classes()).toContain('text-red-600')
  })

  it('shows COGS warning when cogsUsd is 0 and revenue > 0', () => {
    const w = mountSheet({ cogsUsd: 0, revenueUsd: 450 })
    expect(w.find('[data-testid="cogs-warning"]').exists()).toBe(true)
  })

  it('hides COGS warning when cogsUsd > 0', () => {
    const w = mountSheet({ cogsUsd: 100 })
    expect(w.find('[data-testid="cogs-warning"]').exists()).toBe(false)
  })

  it('emits close when backdrop is clicked', async () => {
    const w = mountSheet()
    await w.find('[data-testid="profit-backdrop"]').trigger('click')
    expect(w.emitted('close')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to verify tests fail**

Run: `npx vitest run src/__tests__/features/ProfitSheet.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ProfitSheet**

Create `src/features/dashboard/components/ProfitSheet.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue'
import type { Period } from '@/features/dashboard/composables/periodUtils'

const props = defineProps<{
  isOpen:      boolean
  revenueUsd:  number
  cogsUsd:     number
  expensesUsd: number
  profitUsd:   number
  period:      Period
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

const grossProfit = computed(() => props.revenueUsd - props.cogsUsd)

const periodLabel: Record<Period, string> = {
  today: 'اليوم',
  week:  'الأسبوع',
  month: 'الشهر',
}

const showCogsWarning = computed(() => props.cogsUsd === 0 && props.revenueUsd > 0)

const netProfitClass = computed(() => {
  if (props.profitUsd > 0) return 'text-green-600 dark:text-green-400'
  if (props.profitUsd < 0) return 'text-red-600 dark:text-red-400'
  return 'text-gray-500 dark:text-gray-400'
})

function fmt(n: number, sign = false): string {
  const abs = Math.abs(n).toFixed(2)
  if (sign && n > 0) return `+$${abs}`
  if (n < 0)         return `−$${abs}`
  return `$${abs}`
}
</script>

<template>
  <div
    v-if="isOpen"
    class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40"
    dir="rtl"
    data-testid="profit-backdrop"
    @click.self="emit('close')"
  >
    <div class="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl w-full max-w-md p-6 shadow-xl">
      <!-- Handle -->
      <div class="w-9 h-1 bg-gray-200 dark:bg-gray-700 rounded-full mx-auto mb-4 sm:hidden"></div>

      <h2 class="text-base font-bold text-gray-900 dark:text-white mb-1">تفصيل الربح</h2>
      <p class="text-xs text-gray-400 dark:text-gray-500 mb-5">{{ periodLabel[period] }}</p>

      <!-- 5 rows -->
      <div class="flex flex-col divide-y divide-gray-100 dark:divide-gray-800">

        <div class="flex justify-between items-center py-3" data-testid="row-revenue">
          <span class="text-sm text-gray-500 dark:text-gray-400">إجمالي البيع</span>
          <span class="text-sm font-semibold text-green-600 dark:text-green-400">{{ fmt(revenueUsd, true) }}</span>
        </div>

        <div class="flex justify-between items-center py-3" data-testid="row-cogs">
          <span class="text-sm text-gray-500 dark:text-gray-400">تكلفة البضاعة المباعة</span>
          <span class="text-sm font-semibold text-red-500">{{ cogsUsd > 0 ? `−$${cogsUsd.toFixed(2)}` : '$0.00' }}</span>
        </div>

        <!-- COGS warning -->
        <div
          v-if="showCogsWarning"
          data-testid="cogs-warning"
          class="py-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3"
        >
          ⚠ بعض المنتجات بدون سعر تكلفة — الربح الإجمالي قد يكون أعلى من الحقيقي
        </div>

        <div class="flex justify-between items-center py-3 font-medium" data-testid="row-gross">
          <span class="text-sm text-gray-700 dark:text-gray-300">الربح الإجمالي</span>
          <span class="text-sm font-semibold text-gray-700 dark:text-gray-300">{{ fmt(grossProfit) }}</span>
        </div>

        <div class="flex justify-between items-center py-3" data-testid="row-expenses">
          <span class="text-sm text-gray-500 dark:text-gray-400">المصاريف</span>
          <span class="text-sm font-semibold text-red-500">{{ expensesUsd > 0 ? `−$${expensesUsd.toFixed(2)}` : '$0.00' }}</span>
        </div>

        <div
          class="flex justify-between items-center pt-4"
          data-testid="row-net"
          :class="netProfitClass"
        >
          <span class="text-base font-bold">صافي الربح</span>
          <span class="text-xl font-extrabold">{{ fmt(profitUsd, true) }}</span>
        </div>

      </div>

      <!-- Close button -->
      <button
        type="button"
        class="mt-5 w-full h-11 rounded-xl text-sm text-gray-600 dark:text-gray-400
               border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
        @click="emit('close')"
      >إغلاق</button>
    </div>
  </div>
</template>
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/__tests__/features/ProfitSheet.test.ts`
Expected: 6 passing

- [ ] **Step 5: Wire ProfitSheet into HomePage.vue**

In `src/pages/HomePage.vue`:

Add import at the top:
```ts
import ProfitSheet from '@/features/dashboard/components/ProfitSheet.vue'
```

At the end of the template (after `</AppDialog>` and before `</AppToast>`), add:
```html
<ProfitSheet
  v-if="showProfitSheet"
  :is-open="showProfitSheet"
  :revenue-usd="metrics.revenueUsd.value"
  :cogs-usd="metrics.cogsUsd.value"
  :expenses-usd="metrics.expensesUsd.value"
  :profit-usd="metrics.profitUsd.value"
  :period="period.value"
  @close="showProfitSheet = false"
/>
```

- [ ] **Step 6: Run full suite**

Run: `npm test`
Expected: all tests pass

- [ ] **Step 7: Commit**

```bash
git add src/features/dashboard/components/ProfitSheet.vue src/__tests__/features/ProfitSheet.test.ts src/pages/HomePage.vue
git commit -m "feat(dashboard): add ProfitSheet breakdown bottom sheet"
```

---

## Task 5: useCashDrawer + CashDrawerBar + CashDrawerSheet + HomePage wiring

**Files:**
- Create: `src/features/dashboard/composables/useCashDrawer.ts`
- Create: `src/features/dashboard/components/CashDrawerBar.vue`
- Create: `src/features/dashboard/components/CashDrawerSheet.vue`
- Create: `src/__tests__/features/useCashDrawer.test.ts`
- Modify: `src/pages/HomePage.vue`

- [ ] **Step 1: Write failing tests for useCashDrawer**

Create `src/__tests__/features/useCashDrawer.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useCashDrawer } from '@/features/dashboard/composables/useCashDrawer'
import { db } from '@/data/powersync/db'

describe('useCashDrawer', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockResolvedValue([])
  })

  it('cashUsd and cashSyp default to 0', () => {
    const { cashUsd, cashSyp } = useCashDrawer()
    expect(cashUsd.value).toBe(0)
    expect(cashSyp.value).toBe(0)
  })

  it('load queries cash sales and cash expenses in parallel', async () => {
    const { load } = useCashDrawer()
    await load()
    expect(db.getAll).toHaveBeenCalledTimes(2)
    const calls = vi.mocked(db.getAll).mock.calls.map(c => c[0] as string)
    expect(calls.some(sql => sql.includes('sales') && sql.includes('cash_usd'))).toBe(true)
    expect(calls.some(sql => sql.includes('expenses') && sql.includes('paid_in_cash'))).toBe(true)
  })

  it('calculates cashUsd as cash_usd sales minus USD expenses', async () => {
    vi.mocked(db.getAll)
      .mockResolvedValueOnce([
        { total_usd: 180, total_syp: 0, payment_method: 'cash_usd', created_at: '2025-01-01T10:00:00Z' },
      ])
      .mockResolvedValueOnce([
        { amount_usd: 50, amount: 50, currency: 'USD', category: 'إيجار', created_at: '2025-01-01T11:00:00Z' },
      ])
    const { cashUsd, load } = useCashDrawer()
    await load()
    expect(cashUsd.value).toBe(130) // 180 - 50
  })

  it('calculates cashSyp as cash_syp sales minus SYP expenses', async () => {
    vi.mocked(db.getAll)
      .mockResolvedValueOnce([
        { total_usd: 0, total_syp: 2_000_000, payment_method: 'cash_syp', created_at: '2025-01-01T10:00:00Z' },
      ])
      .mockResolvedValueOnce([
        { amount_usd: 0, amount: 500_000, currency: 'SYP', category: 'كهرباء', created_at: '2025-01-01T11:00:00Z' },
      ])
    const { cashSyp, load } = useCashDrawer()
    await load()
    expect(cashSyp.value).toBe(1_500_000) // 2,000,000 - 500,000
  })

  it('movements includes both sales and expenses sorted newest first', async () => {
    vi.mocked(db.getAll)
      .mockResolvedValueOnce([
        { total_usd: 100, total_syp: 0, payment_method: 'cash_usd', created_at: '2025-01-01T12:00:00Z' },
      ])
      .mockResolvedValueOnce([
        { amount_usd: 30, amount: 30, currency: 'USD', category: 'صيانة', created_at: '2025-01-01T11:00:00Z' },
      ])
    const { movements, load } = useCashDrawer()
    await load()
    expect(movements.value).toHaveLength(2)
    expect(movements.value[0].type).toBe('sale')    // newer
    expect(movements.value[1].type).toBe('expense') // older
    expect(movements.value[1].usd).toBe(-30)        // negative for expense
  })
})
```

- [ ] **Step 2: Run to verify tests fail**

Run: `npx vitest run src/__tests__/features/useCashDrawer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement useCashDrawer**

Create `src/features/dashboard/composables/useCashDrawer.ts`:

```ts
import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'

export interface CashMovement {
  type:      'sale' | 'expense'
  label:     string
  usd:       number
  syp:       number
  createdAt: string
}

type SaleRow    = { total_usd: number; total_syp: number; payment_method: string; created_at: string }
type ExpenseRow = { amount_usd: number; amount: number; currency: string; category: string; created_at: string }

export function useCashDrawer() {
  const cashUsd   = ref(0)
  const cashSyp   = ref(0)
  const movements = ref<CashMovement[]>([])

  function getDayStart(): string {
    const now = new Date()
    const dayStart = new Date(now)
    dayStart.setHours(6, 0, 0, 0)
    // If before 6 AM, use yesterday's 6 AM
    if (now < dayStart) dayStart.setDate(dayStart.getDate() - 1)
    return dayStart.toISOString()
  }

  async function load() {
    const device = useDeviceStore()
    const dayStart = getDayStart()

    const [salesRows, expenseRows] = await Promise.all([
      db.getAll<SaleRow>(
        `SELECT total_usd, total_syp, payment_method, created_at FROM sales
         WHERE shop_id = ? AND payment_method IN ('cash_usd', 'cash_syp') AND created_at >= ?
         ORDER BY created_at DESC`,
        [device.shopId, dayStart]
      ),
      db.getAll<ExpenseRow>(
        `SELECT amount_usd, amount, currency, category, created_at FROM expenses
         WHERE shop_id = ? AND paid_in_cash = 1 AND created_at >= ?
         ORDER BY created_at DESC`,
        [device.shopId, dayStart]
      ),
    ])

    // Totals
    let totalUsd = 0
    let totalSyp = 0
    for (const s of salesRows) {
      if (s.payment_method === 'cash_usd') totalUsd += s.total_usd
      if (s.payment_method === 'cash_syp') totalSyp += s.total_syp
    }
    for (const e of expenseRows) {
      if (e.currency === 'USD') totalUsd -= e.amount_usd
      if (e.currency === 'SYP') totalSyp -= e.amount
    }
    cashUsd.value = totalUsd
    cashSyp.value = totalSyp

    // Movements (merge + sort newest first)
    const saleMoves: CashMovement[] = salesRows.map(s => ({
      type:      'sale' as const,
      label:     'بيع',
      usd:       s.payment_method === 'cash_usd' ? s.total_usd : 0,
      syp:       s.payment_method === 'cash_syp' ? s.total_syp : 0,
      createdAt: s.created_at,
    }))
    const expenseMoves: CashMovement[] = expenseRows.map(e => ({
      type:      'expense' as const,
      label:     `مصروف: ${e.category}`,
      usd:       e.currency === 'USD' ? -e.amount_usd : 0,
      syp:       e.currency === 'SYP' ? -e.amount : 0,
      createdAt: e.created_at,
    }))
    movements.value = [...saleMoves, ...expenseMoves]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  return { cashUsd, cashSyp, movements, load }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/__tests__/features/useCashDrawer.test.ts`
Expected: 5 passing

- [ ] **Step 5: Create CashDrawerBar.vue**

Create `src/features/dashboard/components/CashDrawerBar.vue`:

```vue
<script setup lang="ts">
defineProps<{
  cashUsd: number
  cashSyp: number
}>()

const emit = defineEmits<{ (e: 'tap'): void }>()
</script>

<template>
  <div
    class="bg-white dark:bg-gray-800 rounded-2xl shadow-sm p-4 flex items-center justify-between
           cursor-pointer active:scale-[0.98] transition-transform"
    dir="rtl"
    data-testid="cash-drawer-bar"
    role="button"
    @click="emit('tap')"
  >
    <div>
      <p class="text-xs text-gray-500 dark:text-gray-400 mb-1">النقد المتوقع في الدرج</p>
      <p class="text-sm font-bold text-gray-900 dark:text-white">
        <span v-if="cashUsd !== 0">${{ cashUsd.toFixed(2) }}</span>
        <span v-if="cashUsd !== 0 && cashSyp !== 0" class="text-gray-400 mx-1">+</span>
        <span v-if="cashSyp !== 0">{{ Math.round(cashSyp).toLocaleString('en-US') }} ل.س</span>
        <span v-if="cashUsd === 0 && cashSyp === 0" class="text-gray-400">$0</span>
      </p>
    </div>
    <span class="text-xl">💰</span>
  </div>
</template>
```

- [ ] **Step 6: Create CashDrawerSheet.vue**

Create `src/features/dashboard/components/CashDrawerSheet.vue`:

```vue
<script setup lang="ts">
import type { CashMovement } from '@/features/dashboard/composables/useCashDrawer'

const props = defineProps<{
  isOpen:    boolean
  cashUsd:   number
  cashSyp:   number
  movements: CashMovement[]
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

function relativeTime(iso: string): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (diffMin < 1)  return 'الآن'
  if (diffMin < 60) return `قبل ${diffMin} دقيقة`
  return `قبل ${Math.floor(diffMin / 60)} ساعة`
}

function fmtUsd(n: number): string {
  if (n === 0) return ''
  return n > 0 ? `+$${n.toFixed(2)}` : `−$${Math.abs(n).toFixed(2)}`
}

function fmtSyp(n: number): string {
  if (n === 0) return ''
  const abs = Math.round(Math.abs(n)).toLocaleString('en-US')
  return n > 0 ? `+${abs} ل.س` : `−${abs} ل.س`
}
</script>

<template>
  <div
    v-if="isOpen"
    class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40"
    dir="rtl"
    @click.self="emit('close')"
  >
    <div class="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl w-full max-w-md p-6 shadow-xl max-h-[80vh] flex flex-col">
      <!-- Handle -->
      <div class="w-9 h-1 bg-gray-200 dark:bg-gray-700 rounded-full mx-auto mb-4 sm:hidden shrink-0"></div>

      <h2 class="text-base font-bold text-gray-900 dark:text-white mb-1 shrink-0">حركات النقد — اليوم</h2>

      <!-- Summary -->
      <div class="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 mb-4 shrink-0">
        <p class="text-xs text-gray-500 mb-1">الإجمالي المتوقع</p>
        <p class="text-sm font-bold text-gray-900 dark:text-white">
          <span v-if="cashUsd !== 0">${{ cashUsd.toFixed(2) }}</span>
          <span v-if="cashUsd !== 0 && cashSyp !== 0" class="text-gray-400 mx-1">+</span>
          <span v-if="cashSyp !== 0">{{ Math.round(cashSyp).toLocaleString('en-US') }} ل.س</span>
          <span v-if="cashUsd === 0 && cashSyp === 0" class="text-gray-400">$0</span>
        </p>
      </div>

      <!-- Movements list -->
      <div class="flex-1 overflow-y-auto flex flex-col gap-2 mb-4">
        <div
          v-if="movements.length === 0"
          class="text-center py-8 text-gray-400 text-sm"
        >لا توجد حركات نقدية اليوم</div>

        <div
          v-for="(m, i) in movements"
          :key="i"
          class="flex items-center justify-between py-2 border-b border-gray-100 dark:border-gray-800"
        >
          <div>
            <p class="text-sm font-medium" :class="m.type === 'sale' ? 'text-gray-900 dark:text-white' : 'text-gray-600 dark:text-gray-400'">
              {{ m.label }}
            </p>
            <p class="text-xs text-gray-400">{{ relativeTime(m.createdAt) }}</p>
          </div>
          <div class="text-left">
            <p v-if="m.usd !== 0" class="text-sm font-semibold" :class="m.usd > 0 ? 'text-green-600' : 'text-red-500'">
              {{ fmtUsd(m.usd) }}
            </p>
            <p v-if="m.syp !== 0" class="text-sm font-semibold" :class="m.syp > 0 ? 'text-green-600' : 'text-red-500'">
              {{ fmtSyp(m.syp) }}
            </p>
          </div>
        </div>
      </div>

      <button
        type="button"
        class="w-full h-11 rounded-xl text-sm text-gray-600 dark:text-gray-400
               border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 shrink-0"
        @click="emit('close')"
      >إغلاق</button>
    </div>
  </div>
</template>
```

- [ ] **Step 7: Wire cash drawer into HomePage.vue**

In `src/pages/HomePage.vue`:

Add imports:
```ts
import { useCashDrawer }    from '@/features/dashboard/composables/useCashDrawer'
import CashDrawerBar        from '@/features/dashboard/components/CashDrawerBar.vue'
import CashDrawerSheet      from '@/features/dashboard/components/CashDrawerSheet.vue'
```

Add in `<script setup>`:
```ts
const drawer          = useCashDrawer()
const showCashDrawer  = ref(false)
```

Add `drawer.load()` to the `onMounted` Promise.all:
```ts
await Promise.all([metrics.load(period.value), sellers.load(period.value), drawer.load()])
```

In the template, add `CashDrawerBar` between BestSellersCard and the low-stock card:
```html
<!-- Cash drawer row -->
<CashDrawerBar
  :cash-usd="drawer.cashUsd.value"
  :cash-syp="drawer.cashSyp.value"
  class="mb-4"
  @tap="showCashDrawer = true"
/>
```

At the end of the template (with the other sheets):
```html
<CashDrawerSheet
  :is-open="showCashDrawer"
  :cash-usd="drawer.cashUsd.value"
  :cash-syp="drawer.cashSyp.value"
  :movements="drawer.movements.value"
  @close="showCashDrawer = false"
/>
```

- [ ] **Step 8: Run full test suite**

Run: `npm test`
Expected: all tests pass

- [ ] **Step 9: Commit**

```bash
git add src/features/dashboard/composables/useCashDrawer.ts \
        src/features/dashboard/components/CashDrawerBar.vue \
        src/features/dashboard/components/CashDrawerSheet.vue \
        src/__tests__/features/useCashDrawer.test.ts \
        src/pages/HomePage.vue
git commit -m "feat(dashboard): add cash drawer indicator with movement detail sheet"
```

---

## Task 6: Full verification

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: all tests pass, 0 failures

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Smoke test in browser**

Open `http://localhost:5175` (or run `npm run dev` first).

Check:
- Tap **المال الداخل** card → navigates to `/history?period=today` with period toggle visible and sales total in header
- Tap **المصاريف** card → navigates to `/expenses?period=today` with period toggle and expense list
- Tap period toggle on either drill-down screen → cards on home screen also change period
- Tap an expense row → expense form opens pre-filled with existing values; save updates list
- Tap **الربح** card → profit breakdown sheet slides up with 5 rows; tap backdrop or إغلاق to dismiss
- Home screen shows **💰 النقد المتوقع في الدرج** row between best sellers and low-stock
- Tap cash drawer row → detail sheet shows cash movements (sales green, expenses red)
- All screens look correct on phone width AND on a wider window (tables on desktop, centered modals)
