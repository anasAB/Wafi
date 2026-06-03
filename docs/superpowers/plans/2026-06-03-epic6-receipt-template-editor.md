# Epic 6 — Receipt Template Editor: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let shop owners configure their receipt template (shop name, tax number, header, footer) and see a live preview — values flow into every printed receipt via `ReceiptData`.

**Architecture:** New `receipt_settings` PowerSync table (one row per shop, upserted). New `src/features/receipt/` folder with types, `useReceiptSettings` composable, `ReceiptTemplatePreview` component, and `ReceiptSettingsScreen`. Navigation wired via a new `/settings/receipt` route and a tile in `SettingsPage`. `SaleConfirmationScreen` loads the template on print.

**Tech Stack:** Vue 3 + TypeScript + Tailwind, PowerSync (`db.execute`, `db.getOptional`), Vitest + `@vue/test-utils`, existing `useDeviceStore` for `shopId`.

---

## File Map

**Create:**
- `src/features/receipt/receipt.types.ts`
- `src/features/receipt/composables/useReceiptSettings.ts`
- `src/features/receipt/components/ReceiptTemplatePreview.vue`
- `src/features/receipt/ReceiptSettingsScreen.vue`
- `src/__tests__/features/useReceiptSettings.test.ts`
- `src/__tests__/features/ReceiptTemplatePreview.test.ts`

**Modify:**
- `src/data/powersync/schema.ts` — add `receipt_settings` table
- `src/composables/usePrinter.ts` — add `taxNumber?`, `headerText?`, `footerText?` to `ReceiptData`
- `src/router/index.ts` — add `/settings/receipt` route
- `src/pages/SettingsPage.vue` — add receipt tile to mobile list + desktop sidebar
- `src/features/pos/SaleConfirmationScreen.vue` — load template on print

---

## Task 1: Schema — add receipt_settings table

**Files:**
- Modify: `src/data/powersync/schema.ts`

- [ ] **Step 1: Add receipt_settings table**

In `src/data/powersync/schema.ts`, add the new table before the `AppSchema` export:

```ts
const receipt_settings = new Table({
  shop_id:     column.text,
  shop_name:   column.text,
  tax_number:  column.text,
  header_text: column.text,
  footer_text: column.text,
  updated_at:  column.text,
  sync_status: column.text,
})
```

Then add it to the `AppSchema` export:

```ts
export const AppSchema = new Schema({
  products,
  stock_adjustments,
  sales,
  sale_line_items,
  exchange_rates,
  expenses,
  customers,
  customer_payments,
  receipt_settings,
})
```

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/data/powersync/schema.ts
git commit -m "feat(schema): add receipt_settings table"
```

---

## Task 2: Types + extend ReceiptData

**Files:**
- Create: `src/features/receipt/receipt.types.ts`
- Modify: `src/composables/usePrinter.ts`

- [ ] **Step 1: Create receipt types**

Create `src/features/receipt/receipt.types.ts`:

```ts
export interface ReceiptSettings {
  shopName:   string
  taxNumber:  string
  headerText: string
  footerText: string
}

export interface ReceiptSettingsRow {
  id:          string
  shop_id:     string
  shop_name:   string
  tax_number:  string
  header_text: string
  footer_text: string
  updated_at:  string
  sync_status: string
}
```

- [ ] **Step 2: Extend ReceiptData in usePrinter.ts**

In `src/composables/usePrinter.ts`, add three optional fields to `ReceiptData`:

```ts
export interface ReceiptData {
  saleId:            string
  displaySaleNumber: string
  shopName:          string
  createdAt:         string
  lines: Array<{
    nameAr:        string
    quantity:      number
    unitPriceUsd:  number
    lineTotalUsd:  number
  }>
  totalUsd:                 number
  totalSyp:                 number
  exchangeRate:             number
  paymentMethod:            PaymentMethod
  amountReceived?:          number
  amountReceivedCurrency?:  'USD' | 'SYP'
  changeDue?:               number
  taxNumber?:               string
  headerText?:              string
  footerText?:              string
}
```

- [ ] **Step 3: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/features/receipt/receipt.types.ts src/composables/usePrinter.ts
git commit -m "feat(receipt): add receipt types and extend ReceiptData"
```

---

## Task 3: useReceiptSettings composable (TDD)

**Files:**
- Create: `src/features/receipt/composables/useReceiptSettings.ts`
- Create: `src/__tests__/features/useReceiptSettings.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/features/useReceiptSettings.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useReceiptSettings } from '@/features/receipt/composables/useReceiptSettings'
import { db } from '@/data/powersync/db'

describe('useReceiptSettings', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getOptional).mockResolvedValue(null)
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
  })

  it('settings defaults to empty strings', () => {
    const { settings } = useReceiptSettings()
    expect(settings.value.shopName).toBe('')
    expect(settings.value.taxNumber).toBe('')
    expect(settings.value.headerText).toBe('')
    expect(settings.value.footerText).toBe('')
  })

  it('load sets settings to empty defaults when no row exists', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce(null)
    const { settings, load } = useReceiptSettings()
    await load()
    expect(settings.value.shopName).toBe('')
  })

  it('load maps row to settings', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({
      id: 's1', shop_id: 's1', shop_name: 'محل الإلكترونيات',
      tax_number: '12345678', header_text: 'Accessories', footer_text: 'شكراً',
      updated_at: '2025-01-01T00:00:00Z', sync_status: 'synced',
    } as any)
    const { settings, load } = useReceiptSettings()
    await load()
    expect(settings.value.shopName).toBe('محل الإلكترونيات')
    expect(settings.value.taxNumber).toBe('12345678')
    expect(settings.value.footerText).toBe('شكراً')
  })

  it('save calls INSERT OR REPLACE INTO receipt_settings', async () => {
    const { save } = useReceiptSettings()
    await save({ shopName: 'محل', taxNumber: '999', headerText: '', footerText: 'شكراً' })
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('INSERT OR REPLACE INTO receipt_settings'),
      expect.any(Array)
    )
  })

  it('save updates settings ref after saving', async () => {
    const { settings, save } = useReceiptSettings()
    await save({ shopName: 'New Shop', taxNumber: '', headerText: '', footerText: '' })
    expect(settings.value.shopName).toBe('New Shop')
  })
})
```

- [ ] **Step 2: Run to verify tests fail**

Run: `npx vitest run src/__tests__/features/useReceiptSettings.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

Create `src/features/receipt/composables/useReceiptSettings.ts`:

```ts
import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import type { ReceiptSettings, ReceiptSettingsRow } from '@/features/receipt/receipt.types'

export function useReceiptSettings() {
  const settings = ref<ReceiptSettings>({
    shopName: '', taxNumber: '', headerText: '', footerText: '',
  })

  async function load(): Promise<void> {
    const device = useDeviceStore()
    const row = await db.getOptional<ReceiptSettingsRow>(
      `SELECT * FROM receipt_settings WHERE shop_id = ? LIMIT 1`,
      [device.shopId]
    )
    if (row) {
      settings.value = {
        shopName:   row.shop_name   ?? '',
        taxNumber:  row.tax_number  ?? '',
        headerText: row.header_text ?? '',
        footerText: row.footer_text ?? '',
      }
    }
  }

  async function save(data: ReceiptSettings): Promise<void> {
    const device = useDeviceStore()
    const now    = new Date().toISOString()
    await db.execute(
      `INSERT OR REPLACE INTO receipt_settings
         (id, shop_id, shop_name, tax_number, header_text, footer_text, updated_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [device.shopId, device.shopId, data.shopName, data.taxNumber,
       data.headerText, data.footerText, now]
    )
    settings.value = { ...data }
  }

  return { settings, load, save }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/__tests__/features/useReceiptSettings.test.ts`
Expected: 5 passing

- [ ] **Step 5: Commit**

```bash
git add src/features/receipt/composables/useReceiptSettings.ts src/__tests__/features/useReceiptSettings.test.ts
git commit -m "feat(receipt): add useReceiptSettings composable"
```

---

## Task 4: ReceiptTemplatePreview component (TDD)

**Files:**
- Create: `src/features/receipt/components/ReceiptTemplatePreview.vue`
- Create: `src/__tests__/features/ReceiptTemplatePreview.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/features/ReceiptTemplatePreview.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ReceiptTemplatePreview from '@/features/receipt/components/ReceiptTemplatePreview.vue'
import type { ReceiptSettings } from '@/features/receipt/receipt.types'

const empty: ReceiptSettings = { shopName: '', taxNumber: '', headerText: '', footerText: '' }

function mountPreview(settings: Partial<ReceiptSettings> = {}) {
  return mount(ReceiptTemplatePreview, {
    props: { settings: { ...empty, ...settings } },
  })
}

describe('ReceiptTemplatePreview', () => {
  it('always renders the dummy sale line', () => {
    const w = mountPreview()
    expect(w.find('[data-testid="preview-dummy-line"]').exists()).toBe(true)
  })

  it('renders shopName when set', () => {
    const w = mountPreview({ shopName: 'محل الإلكترونيات' })
    expect(w.find('[data-testid="preview-shop-name"]').text()).toBe('محل الإلكترونيات')
  })

  it('shows placeholder name when shopName is empty', () => {
    const w = mountPreview({ shopName: '' })
    expect(w.find('[data-testid="preview-shop-name"]').text()).toContain('اسم المحل')
  })

  it('renders taxNumber when set', () => {
    const w = mountPreview({ taxNumber: '12345678' })
    expect(w.find('[data-testid="preview-tax-number"]').exists()).toBe(true)
    expect(w.find('[data-testid="preview-tax-number"]').text()).toContain('12345678')
  })

  it('hides taxNumber when empty', () => {
    const w = mountPreview({ taxNumber: '' })
    expect(w.find('[data-testid="preview-tax-number"]').exists()).toBe(false)
  })

  it('renders headerText when set', () => {
    const w = mountPreview({ headerText: 'Electronics & Accessories' })
    expect(w.find('[data-testid="preview-header-text"]').exists()).toBe(true)
    expect(w.find('[data-testid="preview-header-text"]').text()).toBe('Electronics & Accessories')
  })

  it('hides headerText when empty', () => {
    const w = mountPreview({ headerText: '' })
    expect(w.find('[data-testid="preview-header-text"]').exists()).toBe(false)
  })

  it('renders footerText when set', () => {
    const w = mountPreview({ footerText: 'شكراً لزيارتكم' })
    expect(w.find('[data-testid="preview-footer-text"]').exists()).toBe(true)
    expect(w.find('[data-testid="preview-footer-text"]').text()).toBe('شكراً لزيارتكم')
  })

  it('hides footerText when empty', () => {
    const w = mountPreview({ footerText: '' })
    expect(w.find('[data-testid="preview-footer-text"]').exists()).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify tests fail**

Run: `npx vitest run src/__tests__/features/ReceiptTemplatePreview.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

Create `src/features/receipt/components/ReceiptTemplatePreview.vue`:

```vue
<script setup lang="ts">
import type { ReceiptSettings } from '@/features/receipt/receipt.types'

const props = defineProps<{ settings: ReceiptSettings }>()

const DUMMY_LINE = { name: 'Samsung A55', qty: 1, price: 220 }
const DUMMY_TOTAL_USD = 220
const DUMMY_TOTAL_SYP = 3_190_000
</script>

<template>
  <div
    class="bg-white text-gray-900 rounded-xl p-4 font-mono text-xs leading-relaxed border border-gray-200 max-w-xs mx-auto"
    dir="rtl"
  >
    <!-- Shop name -->
    <p
      data-testid="preview-shop-name"
      class="text-center font-bold text-sm mb-0.5"
    >{{ settings.shopName || 'اسم المحل' }}</p>

    <!-- Header text -->
    <p
      v-if="settings.headerText"
      data-testid="preview-header-text"
      class="text-center text-gray-500 mb-0.5"
    >{{ settings.headerText }}</p>

    <!-- Tax number -->
    <p
      v-if="settings.taxNumber"
      data-testid="preview-tax-number"
      class="text-center text-gray-500 mb-1"
    >الرقم الضريبي: {{ settings.taxNumber }}</p>

    <div class="border-t border-dashed border-gray-300 my-2" />

    <!-- Dummy line item -->
    <div
      data-testid="preview-dummy-line"
      class="flex justify-between"
    >
      <span>{{ DUMMY_LINE.name }} ×{{ DUMMY_LINE.qty }}</span>
      <span>${{ DUMMY_LINE.price.toFixed(2) }}</span>
    </div>

    <div class="border-t border-dashed border-gray-300 my-2" />

    <!-- Totals -->
    <div class="flex justify-between font-semibold">
      <span>المجموع</span>
      <span>${{ DUMMY_TOTAL_USD.toFixed(2) }}</span>
    </div>
    <div class="flex justify-between text-gray-500 mt-0.5">
      <span>بالليرة</span>
      <span>{{ DUMMY_TOTAL_SYP.toLocaleString() }} ل.س</span>
    </div>

    <!-- Footer -->
    <template v-if="settings.footerText">
      <div class="border-t border-dashed border-gray-300 my-2" />
      <p
        data-testid="preview-footer-text"
        class="text-center text-gray-500"
      >{{ settings.footerText }}</p>
    </template>
  </div>
</template>
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/__tests__/features/ReceiptTemplatePreview.test.ts`
Expected: 9 passing

- [ ] **Step 5: Commit**

```bash
git add src/features/receipt/components/ReceiptTemplatePreview.vue src/__tests__/features/ReceiptTemplatePreview.test.ts
git commit -m "feat(receipt): add ReceiptTemplatePreview component"
```

---

## Task 5: ReceiptSettingsScreen

**Files:**
- Create: `src/features/receipt/ReceiptSettingsScreen.vue`

- [ ] **Step 1: Create the screen**

Create `src/features/receipt/ReceiptSettingsScreen.vue`:

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppToast from '@/components/ui/AppToast.vue'
import ReceiptTemplatePreview from './components/ReceiptTemplatePreview.vue'
import { useReceiptSettings } from './composables/useReceiptSettings'

const router = useRouter()
const { settings, load, save } = useReceiptSettings()

const shopName   = ref('')
const taxNumber  = ref('')
const headerText = ref('')
const footerText = ref('')
const saving     = ref(false)
const toast      = ref<{ message: string; type: 'success' | 'error' } | null>(null)

const preview = ref({
  shopName: '', taxNumber: '', headerText: '', footerText: '',
})

onMounted(async () => {
  await load()
  shopName.value   = settings.value.shopName
  taxNumber.value  = settings.value.taxNumber
  headerText.value = settings.value.headerText
  footerText.value = settings.value.footerText
  syncPreview()
})

function syncPreview() {
  preview.value = {
    shopName:   shopName.value,
    taxNumber:  taxNumber.value,
    headerText: headerText.value,
    footerText: footerText.value,
  }
}

async function handleSave() {
  saving.value = true
  try {
    await save({
      shopName:   shopName.value.trim(),
      taxNumber:  taxNumber.value.trim(),
      headerText: headerText.value.trim(),
      footerText: footerText.value.trim(),
    })
    toast.value = { message: 'تم حفظ إعدادات الفاتورة', type: 'success' }
  } catch {
    toast.value = { message: 'خطأ في الحفظ', type: 'error' }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <!-- Header: shown on mobile (md:hidden in SettingsPage handles desktop) -->
  <div class="md:hidden">
    <AppHeader
      title="إعدادات الفاتورة"
      :show-back="true"
      @back="router.back()"
    />
  </div>

  <div class="px-4 py-4 md:p-5 max-w-lg mx-auto w-full md:max-w-none" dir="rtl">

    <!-- Form -->
    <p class="text-xs font-semibold text-text-muted mb-2 px-1 md:px-0 tracking-widest uppercase">معلومات الفاتورة</p>
    <div class="glass-sm overflow-hidden mb-5">

      <!-- Shop name -->
      <div class="px-4 py-3.5 border-b border-border-glass">
        <label class="block text-sm text-text-muted mb-1.5">اسم المحل</label>
        <input
          v-model="shopName"
          data-testid="input-shop-name"
          type="text"
          placeholder="محل الإلكترونيات الحديث"
          class="w-full bg-transparent text-sm text-text-primary placeholder:text-text-muted
                 focus:outline-none border-b border-border-glass pb-1"
          @input="syncPreview"
        />
      </div>

      <!-- Tax number -->
      <div class="px-4 py-3.5 border-b border-border-glass">
        <label class="block text-sm text-text-muted mb-1.5">الرقم الضريبي</label>
        <input
          v-model="taxNumber"
          data-testid="input-tax-number"
          type="text"
          placeholder="12345678"
          class="w-full bg-transparent text-sm text-text-primary placeholder:text-text-muted
                 focus:outline-none border-b border-border-glass pb-1"
          @input="syncPreview"
        />
      </div>

      <!-- Header text -->
      <div class="px-4 py-3.5 border-b border-border-glass">
        <label class="block text-sm text-text-muted mb-1.5">نص الرأس</label>
        <input
          v-model="headerText"
          data-testid="input-header-text"
          type="text"
          placeholder="Electronics & Accessories"
          class="w-full bg-transparent text-sm text-text-primary placeholder:text-text-muted
                 focus:outline-none border-b border-border-glass pb-1"
          @input="syncPreview"
        />
      </div>

      <!-- Footer text -->
      <div class="px-4 py-3.5">
        <label class="block text-sm text-text-muted mb-1.5">نص الذيل</label>
        <input
          v-model="footerText"
          data-testid="input-footer-text"
          type="text"
          placeholder="شكراً لزيارتكم — نراكم قريباً"
          class="w-full bg-transparent text-sm text-text-primary placeholder:text-text-muted
                 focus:outline-none border-b border-border-glass pb-1"
          @input="syncPreview"
        />
      </div>

    </div>

    <!-- Save button -->
    <button
      type="button"
      data-testid="save-btn"
      :disabled="saving"
      class="w-full h-11 rounded-xl text-sm font-semibold text-bg-void mb-6 disabled:opacity-50 transition-colors"
      style="background: linear-gradient(135deg, var(--color-gold-primary), var(--color-gold-to))"
      @click="handleSave"
    >{{ saving ? '...' : 'حفظ' }}</button>

    <!-- Live preview -->
    <p class="text-xs font-semibold text-text-muted mb-3 px-1 md:px-0 tracking-widest uppercase">معاينة الفاتورة</p>
    <ReceiptTemplatePreview :settings="preview" />

  </div>

  <AppToast v-if="toast" :message="toast.message" :type="toast.type" @dismiss="toast = null" />
</template>
```

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/features/receipt/ReceiptSettingsScreen.vue
git commit -m "feat(receipt): add ReceiptSettingsScreen with form and live preview"
```

---

## Task 6: Router + SettingsPage wiring

**Files:**
- Modify: `src/router/index.ts`
- Modify: `src/pages/SettingsPage.vue`

- [ ] **Step 1: Add route to router**

In `src/router/index.ts`, add the new route inside the `/settings` children array:

```ts
{
  path: '/settings',
  component: () => import('@/pages/SettingsPage.vue'),
  children: [
    { path: 'personal', component: () => import('@/features/settings/screens/PersonalPreferencesScreen.vue') },
    { path: 'receipt',  component: () => import('@/features/receipt/ReceiptSettingsScreen.vue') },
  ],
},
```

- [ ] **Step 2: Add receipt tile to mobile list in SettingsPage.vue**

In `src/pages/SettingsPage.vue`, find the mobile layout `<main>` section. After the existing "Personal" button (inside the first `glass-sm` div), add a receipt settings button:

```vue
<button
  type="button"
  class="w-full flex items-center justify-between px-4 py-3.5 border-b border-border-glass text-sm text-text-primary active:bg-surface-glass"
  @click="router.push('/settings/receipt')"
>
  <span>إعدادات الفاتورة</span>
  <svg xmlns="http://www.w3.org/2000/svg" class="w-4 h-4 text-text-muted rtl:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
    <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" />
  </svg>
</button>
```

Add it BEFORE the sign-out button, so the final mobile list order is: Personal → إعدادات الفاتورة → Sign Out.

- [ ] **Step 3: Add receipt entry to desktop sidebar in SettingsPage.vue**

In `src/pages/SettingsPage.vue`, find the desktop sidebar `<nav>` section. Add a RouterLink for receipt after the Personal link:

```vue
<RouterLink
  to="/settings/receipt"
  class="flex items-center justify-between px-4 py-3.5 text-sm border-b border-border-glass transition-colors"
  :class="route.path === '/settings/receipt'
    ? 'text-gold-primary bg-surface-raised font-semibold'
    : 'text-text-muted hover:bg-surface-glass hover:text-text-primary'"
>
  <span>إعدادات الفاتورة</span>
  <span v-if="route.path === '/settings/receipt'" class="w-1.5 h-1.5 rounded-full bg-gold-primary" />
</RouterLink>
```

Add it between the Personal RouterLink and the About div.

- [ ] **Step 4: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/router/index.ts src/pages/SettingsPage.vue
git commit -m "feat(receipt): add /settings/receipt route and Settings navigation entries"
```

---

## Task 7: SaleConfirmationScreen integration

**Files:**
- Modify: `src/features/pos/SaleConfirmationScreen.vue`

- [ ] **Step 1: Update handlePrint to load receipt settings**

In `src/features/pos/SaleConfirmationScreen.vue`, add the import and update `handlePrint`:

Add import at the top of the script:
```ts
import { useReceiptSettings } from '@/features/receipt/composables/useReceiptSettings'
```

Replace the entire `handlePrint` function:

```ts
async function handlePrint() {
  if (!sale) return
  const { settings, load } = useReceiptSettings()
  await load()

  const receipt: ReceiptData = {
    saleId:                 sale.saleId,
    displaySaleNumber:      sale.displaySaleNumber,
    shopName:               settings.value.shopName || device.shopId,
    createdAt:              sale.createdAt,
    lines:                  sale.lines,
    totalUsd:               sale.totalUsd,
    totalSyp:               sale.totalSyp,
    exchangeRate:           sale.exchangeRateAtSale,
    paymentMethod:          sale.paymentMethod as any,
    amountReceived:         sale.amountReceived,
    amountReceivedCurrency: sale.amountReceivedCurrency,
    changeDue:              sale.changeDue,
    taxNumber:              settings.value.taxNumber  || undefined,
    headerText:             settings.value.headerText || undefined,
    footerText:             settings.value.footerText || undefined,
  }
  try {
    await printer.print(receipt)
    toast.value = { message: 'تم إرسال الفاتورة للطباعة', type: 'success' }
  } catch {
    toast.value = { message: `خطأ في الطباعة: ${printer.error.value}`, type: 'error' }
  }
}
```

- [ ] **Step 1b: Fix PaymentMethod type in usePrinter.ts**

`sale.paymentMethod` can now be `'credit'` (added in Epic 5). In `src/composables/usePrinter.ts`, update line 3:

```ts
export type PaymentMethod = 'cash_usd' | 'cash_syp' | 'card' | 'credit'
```

Then remove the `as any` cast in the `ReceiptData` construction above so it reads just `paymentMethod: sale.paymentMethod`.

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
git add src/features/pos/SaleConfirmationScreen.vue src/composables/usePrinter.ts
git commit -m "feat(receipt): load template settings on print in SaleConfirmationScreen"
```

---

## Task 8: Full verification

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: all tests pass, 0 failures

- [ ] **Step 2: TypeScript check**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Start dev server and smoke-test**

Run: `npm run dev`

Check in browser:
- Navigate to Settings → tap "إعدادات الفاتورة" (mobile) or click sidebar entry (desktop)
- Fill in shop name → preview updates live
- Fill in tax number → tax line appears in preview
- Leave header/footer empty → those lines absent from preview
- Fill in footer → footer appears in preview
- Tap "حفظ" → toast confirms
- Reload page → settings persist (loaded from PowerSync)
- Go to POS → complete a sale → tap "طباعة الفاتورة" on confirmation screen → no errors, console shows receipt data with shop name + tax number

- [ ] **Step 4: Commit any smoke-test fixes**

```bash
git add -p
git commit -m "fix: smoke-test corrections"
```
