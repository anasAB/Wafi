# Discount Caps Validation & Silent-Failure Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the Discount Caps settings screen so invalid values (negative, >100, over-precise, cashier > manager, empty) are rejected before they're written anywhere, and a "Saved" toast is never shown for a change that didn't actually reach the server.

**Architecture:** Extract validation into a pure, dependency-free module (`discountCapsValidation.ts`) so range/precision/cross-field rules are unit-testable without mounting Vue or touching PowerSync. Add the same range/hierarchy guard inside `useDiscountCaps.save()` as defense in depth. Rebuild the settings screen around a real `<form>` with inline errors, a confirmation dialog before writing, and a post-save check against the existing `sync_dead_letter` table (already populated by `SupabaseConnector.uploadData` for permanently-rejected writes) to detect and surface an upload that silently failed.

**Tech Stack:** Vue 3 `<script setup>`, Vitest + `@vue/test-utils`, PowerSync web SDK (`@powersync/web`), existing `AppDialog.vue` component.

## Global Constraints

- Discount cap values are stored as `NUMERIC(5,2)` in Postgres (`supabase/migrations/052_sale_discounts.sql`) — valid range `0–100`, max 2 decimal places.
- **Deviation from the design spec, discovered during planning:** the spec called for adding a CHECK constraint to the PowerSync local schema (`src/data/powersync/schema.ts`). PowerSync's `Table`/`column` schema API (`@powersync/web`) only declares column types (`column.text`, `column.real`, etc.) — it has no constraint syntax, so a literal local CHECK isn't possible. The equivalent defense-in-depth is implemented instead as a guard inside `useDiscountCaps.save()` that throws before issuing the `UPDATE`, so an out-of-range value can't be written locally even if a caller bypasses the screen's own validation.
- All user-facing strings are Arabic, RTL, matching existing copy style in this file.
- Toasts/errors follow the existing inline `<p class="...">` pattern already in `DiscountCapsSettingsScreen.vue` — no new toast library.
- The confirmation dialog reuses `src/components/ui/AppDialog.vue` (existing `title`/`message`/`confirmLabel`/`cancelLabel`/`danger` props, `confirm`/`cancel` emits) rather than building a new modal.
- Upload-failure detection reuses `src/data/powersync/dead-letter.ts`'s existing `listDeadLetter(db)` — permanently-rejected ops (constraint violations, RLS) already land in the local `sync_dead_letter` table via `SupabaseConnector.uploadData` → `quarantineOp`. No new sync-layer code is needed to detect a rejected write, only a query against what already exists.
- Test runner: `npm run test` (`vitest run`). Existing test at `src/features/pos/__tests__/DiscountCapsSettingsScreen.test.ts` must be updated, not left broken.

---

### Task 1: Pure validation module

**Files:**
- Create: `src/features/pos/discountCapsValidation.ts`
- Test: `src/features/pos/__tests__/discountCapsValidation.test.ts`

**Interfaces:**
- Consumes: nothing (pure functions, no imports beyond built-ins)
- Produces:
  - `isValidCapPct(value: number): boolean`
  - `interface DiscountCapsErrors { cashier?: string; manager?: string; cross?: string }`
  - `interface ParsedDiscountCaps { cashierPct: number; managerPct: number }`
  - `interface DiscountCapsValidationResult { valid: boolean; errors: DiscountCapsErrors; parsed?: ParsedDiscountCaps }`
  - `validateDiscountCaps(input: { cashier: string; manager: string }): DiscountCapsValidationResult`
  - These are consumed by Task 2 (`useDiscountCaps.ts` imports `isValidCapPct`) and Task 3 (`DiscountCapsSettingsScreen.vue` imports `validateDiscountCaps`, `DiscountCapsErrors`).

- [ ] **Step 1: Write the failing tests**

Create `src/features/pos/__tests__/discountCapsValidation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { validateDiscountCaps, isValidCapPct } from '../discountCapsValidation'

describe('isValidCapPct', () => {
  it('accepts values within 0-100', () => {
    expect(isValidCapPct(0)).toBe(true)
    expect(isValidCapPct(100)).toBe(true)
    expect(isValidCapPct(45.5)).toBe(true)
  })

  it('rejects negative values', () => {
    expect(isValidCapPct(-10)).toBe(false)
  })

  it('rejects values above 100', () => {
    expect(isValidCapPct(150)).toBe(false)
  })

  it('rejects non-finite values', () => {
    expect(isValidCapPct(Infinity)).toBe(false)
    expect(isValidCapPct(NaN)).toBe(false)
  })
})

describe('validateDiscountCaps', () => {
  it('accepts valid caps and returns parsed numbers', () => {
    const result = validateDiscountCaps({ cashier: '10', manager: '25' })
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual({})
    expect(result.parsed).toEqual({ cashierPct: 10, managerPct: 25 })
  })

  it('rejects empty cashier field as required', () => {
    const result = validateDiscountCaps({ cashier: '', manager: '15' })
    expect(result.valid).toBe(false)
    expect(result.errors.cashier).toBe('الرجاء إدخال قيمة')
  })

  it('rejects whitespace-only field as required', () => {
    const result = validateDiscountCaps({ cashier: '   ', manager: '15' })
    expect(result.valid).toBe(false)
    expect(result.errors.cashier).toBe('الرجاء إدخال قيمة')
  })

  it('rejects negative values (BUG-01)', () => {
    const result = validateDiscountCaps({ cashier: '-10', manager: '15' })
    expect(result.valid).toBe(false)
    expect(result.errors.cashier).toBe('يجب أن تكون النسبة بين 0 و100')
  })

  it('rejects values above 100 (BUG-02)', () => {
    const result = validateDiscountCaps({ cashier: '150', manager: '15' })
    expect(result.valid).toBe(false)
    expect(result.errors.cashier).toBe('يجب أن تكون النسبة بين 0 و100')
  })

  it('rejects a 20-digit number via range check (BUG-03)', () => {
    const result = validateDiscountCaps({ cashier: '99999999999999999999', manager: '15' })
    expect(result.valid).toBe(false)
    expect(result.errors.cashier).toBe('يجب أن تكون النسبة بين 0 و100')
  })

  it('rejects more than 2 decimal places', () => {
    const result = validateDiscountCaps({ cashier: '10.555', manager: '15' })
    expect(result.valid).toBe(false)
    expect(result.errors.cashier).toBe('يُسمح بمنزلتين عشريتين كحد أقصى')
  })

  it('accepts exactly 2 decimal places', () => {
    const result = validateDiscountCaps({ cashier: '12.35', manager: '15' })
    expect(result.valid).toBe(true)
    expect(result.parsed?.cashierPct).toBeCloseTo(12.35)
  })

  it('rejects cashier cap exceeding manager cap (BUG-04)', () => {
    const result = validateDiscountCaps({ cashier: '90', manager: '10' })
    expect(result.valid).toBe(false)
    expect(result.errors.cross).toBe('لا يمكن أن يتجاوز حد الكاشير حد المدير')
  })

  it('does not run the cross-field check when either field already has an error', () => {
    const result = validateDiscountCaps({ cashier: '-5', manager: '10' })
    expect(result.errors.cross).toBeUndefined()
  })

  it('accepts cashier equal to manager', () => {
    const result = validateDiscountCaps({ cashier: '15', manager: '15' })
    expect(result.valid).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/pos/__tests__/discountCapsValidation.test.ts`
Expected: FAIL — `Cannot find module '../discountCapsValidation'`

- [ ] **Step 3: Implement the validation module**

Create `src/features/pos/discountCapsValidation.ts`:

```typescript
export interface DiscountCapsErrors {
  cashier?: string
  manager?: string
  cross?: string
}

export interface ParsedDiscountCaps {
  cashierPct: number
  managerPct: number
}

export interface DiscountCapsValidationResult {
  valid: boolean
  errors: DiscountCapsErrors
  parsed?: ParsedDiscountCaps
}

const REQUIRED = 'الرجاء إدخال قيمة'
const OUT_OF_RANGE = 'يجب أن تكون النسبة بين 0 و100'
const TOO_PRECISE = 'يُسمح بمنزلتين عشريتين كحد أقصى'
const CASHIER_EXCEEDS_MANAGER = 'لا يمكن أن يتجاوز حد الكاشير حد المدير'

/** Same range Postgres enforces via CHECK in 052_sale_discounts.sql. */
export function isValidCapPct(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 100
}

function validateField(raw: string): { value?: number; error?: string } {
  const trimmed = raw.trim()
  if (trimmed === '') return { error: REQUIRED }

  const value = Number(trimmed)
  if (Number.isNaN(value) || !isValidCapPct(value)) return { error: OUT_OF_RANGE }

  const rounded = Math.round(value * 100) / 100
  if (Math.abs(rounded - value) > 1e-6) return { error: TOO_PRECISE }

  return { value: rounded }
}

export function validateDiscountCaps(input: { cashier: string; manager: string }): DiscountCapsValidationResult {
  const errors: DiscountCapsErrors = {}
  const cashier = validateField(input.cashier)
  const manager = validateField(input.manager)

  if (cashier.error) errors.cashier = cashier.error
  if (manager.error) errors.manager = manager.error

  if (!cashier.error && !manager.error && cashier.value! > manager.value!) {
    errors.cross = CASHIER_EXCEEDS_MANAGER
  }

  const valid = Object.keys(errors).length === 0
  if (!valid) return { valid, errors }

  return { valid, errors, parsed: { cashierPct: cashier.value!, managerPct: manager.value! } }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/pos/__tests__/discountCapsValidation.test.ts`
Expected: PASS (12 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/pos/discountCapsValidation.ts src/features/pos/__tests__/discountCapsValidation.test.ts
git commit -m "feat(discount-caps): add pure validation module for cap range/precision/hierarchy rules"
```

---

### Task 2: Guard + upload-failure detection in `useDiscountCaps.ts`

**Files:**
- Modify: `src/features/pos/useDiscountCaps.ts:24-32` (the `save` function)
- Test: `src/features/pos/__tests__/useDiscountCaps.test.ts` (new)

**Interfaces:**
- Consumes: `isValidCapPct` from `src/features/pos/discountCapsValidation.ts` (Task 1); `listDeadLetter` from `src/data/powersync/dead-letter.ts` (existing, signature `listDeadLetter(db: AbstractPowerSyncDatabase): Promise<DeadLetterEntry[]>` where `DeadLetterEntry` has `table_name`, `row_id`, `error_message`, `failed_at`); `db` from `src/data/powersync/db.ts`; `useDeviceStore` from `src/store/device.store.ts` (has `.shopId: Ref<string>`).
- Produces: `useDiscountCaps()` now also returns `checkSaveFailed(sinceIso: string): Promise<string | null>`, consumed by Task 3's `DiscountCapsSettingsScreen.vue`. `save()` now throws `Error` for out-of-range or cashier > manager input — Task 3 does not need to catch this (the screen validates before calling save, per Task 3), but this guard must exist as defense in depth per the Global Constraints deviation note above.

- [ ] **Step 1: Write the failing tests**

Create `src/features/pos/__tests__/useDiscountCaps.test.ts`. This mocks `@/data/powersync/db` and `@/data/powersync/dead-letter` directly (no real SQLite), following the mocking style already used in `src/features/pos/__tests__/DiscountCapsSettingsScreen.test.ts`.

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const mockExecute = vi.fn().mockResolvedValue(undefined)
const mockGetOptional = vi.fn().mockResolvedValue(null)
vi.mock('@/data/powersync/db', () => ({
  db: { execute: (...args: unknown[]) => mockExecute(...args), getOptional: (...args: unknown[]) => mockGetOptional(...args) },
}))

const mockListDeadLetter = vi.fn().mockResolvedValue([])
vi.mock('@/data/powersync/dead-letter', () => ({
  listDeadLetter: (...args: unknown[]) => mockListDeadLetter(...args),
}))

vi.mock('@/store/device.store', () => ({
  useDeviceStore: () => ({ shopId: 'shop-1' }),
}))

import { useDiscountCaps } from '../useDiscountCaps'

beforeEach(() => {
  setActivePinia(createPinia())
  mockExecute.mockClear()
  mockGetOptional.mockClear()
  mockListDeadLetter.mockClear()
})

describe('useDiscountCaps.save', () => {
  it('writes valid values and updates local refs', async () => {
    const caps = useDiscountCaps()
    await caps.save({ cashierPct: 10, managerPct: 25 })
    expect(mockExecute).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE shops'),
      [10, 25, 'shop-1'],
    )
    expect(caps.cashierPct.value).toBe(10)
    expect(caps.managerPct.value).toBe(25)
  })

  it('throws and does not write when cashierPct is negative', async () => {
    const caps = useDiscountCaps()
    await expect(caps.save({ cashierPct: -10, managerPct: 25 })).rejects.toThrow()
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('throws and does not write when managerPct exceeds 100', async () => {
    const caps = useDiscountCaps()
    await expect(caps.save({ cashierPct: 10, managerPct: 150 })).rejects.toThrow()
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('throws and does not write when cashierPct exceeds managerPct', async () => {
    const caps = useDiscountCaps()
    await expect(caps.save({ cashierPct: 90, managerPct: 10 })).rejects.toThrow()
    expect(mockExecute).not.toHaveBeenCalled()
  })
})

describe('useDiscountCaps.checkSaveFailed', () => {
  it('returns null when no matching dead-letter entry exists', async () => {
    mockListDeadLetter.mockResolvedValue([])
    const caps = useDiscountCaps()
    const result = await caps.checkSaveFailed('2026-07-31T00:00:00.000Z')
    expect(result).toBeNull()
  })

  it('returns the error message when a matching shops dead-letter entry exists', async () => {
    mockListDeadLetter.mockResolvedValue([
      { table_name: 'shops', row_id: 'shop-1', error_message: 'check constraint violated', failed_at: '2026-07-31T00:00:05.000Z' },
    ])
    const caps = useDiscountCaps()
    const result = await caps.checkSaveFailed('2026-07-31T00:00:00.000Z')
    expect(result).toBe('check constraint violated')
  })

  it('ignores dead-letter entries for a different table or an earlier failure time', async () => {
    mockListDeadLetter.mockResolvedValue([
      { table_name: 'sales', row_id: 'shop-1', error_message: 'unrelated', failed_at: '2026-07-31T00:00:05.000Z' },
      { table_name: 'shops', row_id: 'shop-1', error_message: 'stale', failed_at: '2026-07-30T23:59:00.000Z' },
    ])
    const caps = useDiscountCaps()
    const result = await caps.checkSaveFailed('2026-07-31T00:00:00.000Z')
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/pos/__tests__/useDiscountCaps.test.ts`
Expected: FAIL — `caps.checkSaveFailed is not a function`, and the negative/150/hierarchy cases don't reject since no guard exists yet.

- [ ] **Step 3: Implement the guard and failure check**

Replace `src/features/pos/useDiscountCaps.ts` in full:

```typescript
import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { listDeadLetter } from '@/data/powersync/dead-letter'
import { isValidCapPct } from '@/features/pos/discountCapsValidation'

export function useDiscountCaps() {
  const cashierPct = ref(0)
  const managerPct = ref(15)
  const loaded     = ref(false)

  async function load(): Promise<void> {
    const device = useDeviceStore()
    const row = await db.getOptional<{
      cashier_discount_cap_pct: number | null
      manager_discount_cap_pct: number | null
    }>(
      `SELECT cashier_discount_cap_pct, manager_discount_cap_pct FROM shops WHERE id = ?`,
      [device.shopId],
    )
    cashierPct.value = row?.cashier_discount_cap_pct ?? 0
    managerPct.value = row?.manager_discount_cap_pct ?? 15
    loaded.value = true
  }

  async function save(next: { cashierPct: number; managerPct: number }): Promise<void> {
    // Defense in depth: PowerSync's local Table schema has no CHECK-constraint
    // syntax, so this guard is what stands in for one. The settings screen
    // already validates before calling save(); this exists for any other
    // caller and to fail loudly rather than silently persisting a bad value.
    if (!isValidCapPct(next.cashierPct) || !isValidCapPct(next.managerPct)) {
      throw new Error('Discount cap values must be between 0 and 100')
    }
    if (next.cashierPct > next.managerPct) {
      throw new Error('Cashier discount cap cannot exceed manager discount cap')
    }

    const device = useDeviceStore()
    await db.execute(
      `UPDATE shops SET cashier_discount_cap_pct = ?, manager_discount_cap_pct = ? WHERE id = ?`,
      [next.cashierPct, next.managerPct, device.shopId],
    )
    cashierPct.value = next.cashierPct
    managerPct.value = next.managerPct
  }

  /**
   * A permanently-rejected upload (constraint violation, RLS) lands in
   * sync_dead_letter via SupabaseConnector.uploadData -> quarantineOp. This
   * checks for one matching this shop's row created at/after `sinceIso`, so
   * the caller can tell a "successful" local save apart from one that never
   * actually reached the server.
   */
  async function checkSaveFailed(sinceIso: string): Promise<string | null> {
    const device = useDeviceStore()
    const entries = await listDeadLetter(db)
    const failure = entries.find(
      (e) => e.table_name === 'shops' && e.row_id === device.shopId && e.failed_at >= sinceIso,
    )
    return failure?.error_message ?? null
  }

  return { cashierPct, managerPct, loaded, load, save, checkSaveFailed }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/pos/__tests__/useDiscountCaps.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/features/pos/useDiscountCaps.ts src/features/pos/__tests__/useDiscountCaps.test.ts
git commit -m "feat(discount-caps): guard save() against invalid values, add dead-letter failure check"
```

---

### Task 3: Rebuild the settings screen — form, inline errors, confirmation, labels, failure toast

**Files:**
- Modify: `src/features/pos/DiscountCapsSettingsScreen.vue` (full rewrite of `<script setup>` and `<template>`; styles extended, not replaced)
- Modify: `src/features/pos/__tests__/DiscountCapsSettingsScreen.test.ts` (existing test updated for the new behavior)

**Interfaces:**
- Consumes: `useDiscountCaps()` (Task 2) — `{ cashierPct, managerPct, loaded, load, save, checkSaveFailed }`; `validateDiscountCaps`, `DiscountCapsErrors` from `src/features/pos/discountCapsValidation.ts` (Task 1); `AppDialog` from `src/components/ui/AppDialog.vue` (props `title: string`, `message: string`, `confirmLabel?: string`, `cancelLabel?: string`, `danger?: boolean`, emits `confirm`, `cancel`).
- Produces: nothing new consumed elsewhere — this is the leaf UI component.

- [ ] **Step 1: Write the failing tests**

Replace `src/features/pos/__tests__/DiscountCapsSettingsScreen.test.ts` in full:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'

const mockLoad = vi.fn().mockResolvedValue(undefined)
const mockSave = vi.fn().mockResolvedValue(undefined)
const mockCheckSaveFailed = vi.fn().mockResolvedValue(null)
vi.mock('@/features/pos/useDiscountCaps', () => ({
  useDiscountCaps: () => ({
    cashierPct: { value: 5 }, managerPct: { value: 15 }, loaded: { value: true },
    load: mockLoad, save: mockSave, checkSaveFailed: mockCheckSaveFailed,
  }),
}))

import DiscountCapsSettingsScreen from '@/features/pos/DiscountCapsSettingsScreen.vue'

function mountScreen() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div/>' } }],
  })
  return mount(DiscountCapsSettingsScreen, { global: { plugins: [router] } })
}

beforeEach(() => {
  vi.useFakeTimers()
  setActivePinia(createPinia())
  mockLoad.mockClear()
  mockSave.mockClear()
  mockCheckSaveFailed.mockClear().mockResolvedValue(null)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('DiscountCapsSettingsScreen', () => {
  it('loads caps on mount', () => {
    mountScreen()
    expect(mockLoad).toHaveBeenCalled()
  })

  it('has an accessible label linked to each input', async () => {
    const wrapper = mountScreen()
    await wrapper.vm.$nextTick()
    const cashierInput = wrapper.find('#cashier-cap-input')
    const managerInput = wrapper.find('#manager-cap-input')
    expect(cashierInput.attributes('aria-labelledby')).toBe('cashier-cap-label')
    expect(managerInput.attributes('aria-labelledby')).toBe('manager-cap-label')
    expect(wrapper.find('#cashier-cap-label').exists()).toBe(true)
    expect(wrapper.find('#manager-cap-label').exists()).toBe(true)
  })

  it('submits the form on Enter without a validation error', async () => {
    const wrapper = mountScreen()
    await wrapper.find('#cashier-cap-input').setValue('10')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.find('[data-testid="confirm-dialog"]').exists()).toBe(true)
  })

  it('shows an inline error and does not open the confirm dialog for a negative value (BUG-01)', async () => {
    const wrapper = mountScreen()
    await wrapper.find('#cashier-cap-input').setValue('-10')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.text()).toContain('يجب أن تكون النسبة بين 0 و100')
    expect(wrapper.find('[data-testid="confirm-dialog"]').exists()).toBe(false)
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('shows an inline error for a value above 100 (BUG-02)', async () => {
    const wrapper = mountScreen()
    await wrapper.find('#cashier-cap-input').setValue('150')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.text()).toContain('يجب أن تكون النسبة بين 0 و100')
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('shows a cross-field error when cashier exceeds manager (BUG-04)', async () => {
    const wrapper = mountScreen()
    await wrapper.find('#cashier-cap-input').setValue('90')
    await wrapper.find('#manager-cap-input').setValue('10')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.text()).toContain('لا يمكن أن يتجاوز حد الكاشير حد المدير')
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('shows a required error for an empty field instead of silently saving 0 (BUG-06)', async () => {
    const wrapper = mountScreen()
    await wrapper.find('#cashier-cap-input').setValue('')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.text()).toContain('الرجاء إدخال قيمة')
    expect(mockSave).not.toHaveBeenCalled()
  })

  it('opens a confirmation dialog before saving a valid change, and saves only on confirm', async () => {
    const wrapper = mountScreen()
    await wrapper.find('#cashier-cap-input').setValue('10')
    await wrapper.find('form').trigger('submit')
    expect(mockSave).not.toHaveBeenCalled()

    await wrapper.find('[data-testid="dialog-confirm"]').trigger('click')
    expect(mockSave).toHaveBeenCalledWith({ cashierPct: 10, managerPct: 15 })
  })

  it('does not save if the confirmation dialog is cancelled', async () => {
    const wrapper = mountScreen()
    await wrapper.find('#cashier-cap-input').setValue('10')
    await wrapper.find('form').trigger('submit')

    await wrapper.find('.btn-ghost').trigger('click')
    expect(mockSave).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="confirm-dialog"]').exists()).toBe(false)
  })

  it('shows a success toast immediately after a confirmed save', async () => {
    const wrapper = mountScreen()
    await wrapper.find('#cashier-cap-input').setValue('10')
    await wrapper.find('form').trigger('submit')
    await wrapper.find('[data-testid="dialog-confirm"]').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('تم الحفظ')
  })

  it('downgrades the toast to a failure message if checkSaveFailed later reports a rejection (BUG-05)', async () => {
    mockCheckSaveFailed.mockResolvedValue('check constraint violated')
    const wrapper = mountScreen()
    await wrapper.find('#cashier-cap-input').setValue('10')
    await wrapper.find('form').trigger('submit')
    await wrapper.find('[data-testid="dialog-confirm"]').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('تم الحفظ')

    await vi.advanceTimersByTimeAsync(1500)
    expect(wrapper.text()).toContain('لم يتم الحفظ على الخادم')
    expect(wrapper.text()).not.toContain('تم الحفظ')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/pos/__tests__/DiscountCapsSettingsScreen.test.ts`
Expected: FAIL — no `<form>`, no `#cashier-cap-input` id, no dialog, no inline errors exist yet.

- [ ] **Step 3: Rewrite the component**

Replace `src/features/pos/DiscountCapsSettingsScreen.vue` in full:

```vue
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import { useDiscountCaps } from '@/features/pos/useDiscountCaps'
import { validateDiscountCaps, type DiscountCapsErrors } from '@/features/pos/discountCapsValidation'

const router = useRouter()
const caps = useDiscountCaps()

const cashierInput = ref('0')
const managerInput = ref('15')
const errors = ref<DiscountCapsErrors>({})
const toast = ref<{ kind: 'success' | 'error'; message: string } | null>(null)
const confirming = ref(false)
const pending = ref<{ cashierPct: number; managerPct: number } | null>(null)

onMounted(async () => {
  await caps.load()
  cashierInput.value = String(caps.cashierPct.value)
  managerInput.value = String(caps.managerPct.value)
})

const confirmMessage = computed(() => {
  if (!pending.value) return ''
  const lines: string[] = []
  if (pending.value.cashierPct !== caps.cashierPct.value) {
    lines.push(`سيتغير حد الكاشير من ${caps.cashierPct.value}% إلى ${pending.value.cashierPct}%`)
  }
  if (pending.value.managerPct !== caps.managerPct.value) {
    lines.push(`سيتغير حد المدير من ${caps.managerPct.value}% إلى ${pending.value.managerPct}%`)
  }
  return lines.join(' — ')
})

function submit() {
  const result = validateDiscountCaps({ cashier: cashierInput.value, manager: managerInput.value })
  errors.value = result.errors
  if (!result.valid || !result.parsed) return

  if (result.parsed.cashierPct === caps.cashierPct.value && result.parsed.managerPct === caps.managerPct.value) {
    toast.value = { kind: 'success', message: 'لا توجد تغييرات' }
    return
  }

  pending.value = result.parsed
  confirming.value = true
}

async function confirmSave() {
  if (!pending.value) return
  const next = pending.value
  confirming.value = false
  pending.value = null

  const sinceIso = new Date().toISOString()
  await caps.save(next)
  toast.value = { kind: 'success', message: 'تم الحفظ' }

  setTimeout(async () => {
    const failure = await caps.checkSaveFailed(sinceIso)
    if (failure) {
      toast.value = { kind: 'error', message: 'لم يتم الحفظ على الخادم — سيُعاد المحاولة' }
    }
  }, 1500)
}

function cancelSave() {
  confirming.value = false
  pending.value = null
}

defineExpose({ submit })
</script>

<template>
  <div class="lg:hidden">
    <AppHeader title="حدود الخصم" :show-back="true" @back="router.back()" />
  </div>

  <form class="page-body" dir="rtl" @submit.prevent="submit">
    <p class="hint">أقصى نسبة خصم يمكن لكل رتبة تطبيقها بدون رمز موافقة المالك.</p>
    <p class="hint">الأصحاب غير مقيدين بحد أقصى.</p>

    <div class="field">
      <span id="cashier-cap-label">الكاشير</span>
      <input
        id="cashier-cap-input"
        type="number"
        min="0"
        max="100"
        step="0.01"
        aria-labelledby="cashier-cap-label"
        v-model="cashierInput"
      />
      <span class="suffix">%</span>
    </div>
    <p v-if="errors.cashier" class="field-error">{{ errors.cashier }}</p>

    <div class="field">
      <span id="manager-cap-label">المدير</span>
      <input
        id="manager-cap-input"
        type="number"
        min="0"
        max="100"
        step="0.01"
        aria-labelledby="manager-cap-label"
        v-model="managerInput"
      />
      <span class="suffix">%</span>
    </div>
    <p v-if="errors.manager" class="field-error">{{ errors.manager }}</p>
    <p v-if="errors.cross" class="field-error">{{ errors.cross }}</p>

    <button type="submit" class="save-btn">حفظ</button>

    <p v-if="toast" :class="toast.kind === 'success' ? 'saved-note' : 'error-note'">{{ toast.message }}</p>
  </form>

  <AppDialog
    v-if="confirming"
    data-testid="confirm-dialog"
    title="تأكيد التغيير"
    :message="confirmMessage"
    @confirm="confirmSave"
    @cancel="cancelSave"
  />
</template>

<style scoped>
.page-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-family: 'Tajawal', system-ui, sans-serif;
}
.hint { font-size: 12px; color: #637285; margin: 0 0 6px; }
.field {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(26,86,219,0.14);
  border-radius: 12px;
  padding: 10px 14px;
  color: #E8EDF5;
}
.field input {
  width: 70px;
  background: transparent;
  border: none;
  outline: none;
  color: #E8EDF5;
  font-size: 16px;
  font-weight: 700;
  font-family: inherit;
}
.suffix { color: #637285; }
.field-error { color: #EF4444; font-size: 12px; margin: 0 0 6px; }
.save-btn {
  align-self: flex-start;
  background: #1A56DB;
  color: #fff;
  border: none;
  border-radius: 10px;
  padding: 10px 20px;
  font-weight: 700;
  font-family: inherit;
  cursor: pointer;
  margin-top: 6px;
}
.saved-note { color: #22C55E; font-size: 12px; margin: 8px 0 0; }
.error-note { color: #EF4444; font-size: 12px; margin: 8px 0 0; }
</style>
```

Note: `AppDialog.vue` doesn't currently forward arbitrary attributes like `data-testid` onto its root by name (Vue's automatic attribute inheritance will place `data-testid` on the component's single root element, `.dialog-overlay`, by default — this works as-is since `AppDialog`'s template has a single root node and no `inheritAttrs: false`). No change to `AppDialog.vue` itself is needed.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/pos/__tests__/DiscountCapsSettingsScreen.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: Run the full test suite to check for regressions**

Run: `npm run test`
Expected: PASS — no other file imports `DiscountCapsSettingsScreen.vue`'s old `submit(cashierPct, managerPct)` two-argument signature (confirmed via the codebase search during planning; `defineExpose({ submit })` is only used by this file's own test). If any other test fails, read the failure before changing this component further — it means something else in the codebase relied on the old signature and needs its own follow-up, not a revert of this fix.

- [ ] **Step 6: Commit**

```bash
git add src/features/pos/DiscountCapsSettingsScreen.vue src/features/pos/__tests__/DiscountCapsSettingsScreen.test.ts
git commit -m "fix(discount-caps): validate before save, confirm changes, surface upload failures, add labels"
```

---

### Task 4: Manual verification against the original bug report

No new files. This task re-runs the exact repro steps from the QA report against the built app to confirm each bug is closed, since automated tests cover the logic but not the live PowerSync/Supabase round trip.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Walk through each bug's repro steps on the Discount Caps screen**

- BUG-01: type `-10` into Cashier, submit → inline error shown, no dialog, no save call.
- BUG-02: type `150` into Cashier, submit → inline error shown.
- BUG-03: type `99999999999999999999` into Cashier, submit → inline error shown (range check catches it before precision loss matters).
- BUG-04: Cashier `90`, Manager `10`, submit → cross-field inline error shown.
- BUG-05: perform 10+ rapid successive valid saves (e.g. alternate `10`/`20`/`30`...) → confirm each shows the confirm dialog, confirm each, and after the last one, reload the page and verify the final value persisted matches the last confirmed value, not a reverted default. (This won't reproduce the original race deterministically, but confirms the fix doesn't regress the ability to save correctly, and that a genuine failure — if forced by e.g. briefly disabling network — now shows the failure toast within ~1.5s instead of silently claiming success.)
- BUG-06: clear Cashier field entirely, submit → required-field inline error, no save call.
- BUG-07: inspect DOM (or run a screen reader) — both inputs report an accessible name via `aria-labelledby`.
- BUG-08: focus Cashier input, type a valid value, press Enter → confirm dialog opens (form submits).

- [ ] **Step 3: Note results**

Confirm all eight repro steps above show the expected (fixed) behavior. If any still shows the old broken behavior, treat it as a new bug against this plan's implementation, not a spec gap — the design and tests above account for all eight.

---

## Cross-Epic Edge-Case Checklist (final review)
Matrix rows re-checked after implementation: Sales (`usePayment` / `useDiscountAuthorization.ts` — this plan does not modify how discount caps are read at point-of-sale, only how they're validated and saved; confirmed no other file consumes `DiscountCapsSettingsScreen.vue`'s old two-argument `submit()` signature or `useDiscountCaps()`'s return shape beyond the fields already present).
Domains touched but not covered in the original spec checklist: none — the local-schema CHECK deviation (documented in Global Constraints) is an implementation-detail adjustment to how the spec's intent is achieved, not a new domain interaction.
