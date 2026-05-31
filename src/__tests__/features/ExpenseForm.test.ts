import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/features/exchange-rate', () => ({
  useExchangeRate: () => ({ currentRate: { value: 14500 } }),
}))

import ExpenseForm from '@/features/expenses/components/ExpenseForm.vue'
import { db } from '@/data/powersync/db'

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/:p(.*)', component: { template: '<div/>' } }],
})

function mountForm(props = {}) {
  const pinia = createPinia()
  pinia.use(piniaPluginPersistedstate)
  return mount(ExpenseForm, {
    props,
    global: { plugins: [pinia, router] },
  })
}

describe('ExpenseForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
    vi.mocked(db.getAll).mockResolvedValue([])
  })

  it('shows amount required error when saving with empty amount', async () => {
    const w = mountForm()
    await w.find('[data-testid="save-btn"]').trigger('click')
    expect(w.find('[data-testid="error-amount"]').exists()).toBe(true)
  })

  it('shows category required error when saving with no category', async () => {
    const w = mountForm()
    await w.find('[data-testid="amount-input"]').setValue('50')
    await w.find('[data-testid="save-btn"]').trigger('click')
    expect(w.find('[data-testid="error-category"]').exists()).toBe(true)
  })

  it('shows SYP to USD conversion when SYP is selected', async () => {
    const w = mountForm()
    await w.find('[data-testid="currency-syp"]').trigger('click')
    await w.find('[data-testid="amount-input"]').setValue('1450000')
    // 1,450,000 / 14500 ≈ $100
    expect(w.find('[data-testid="usd-equivalent"]').text()).toContain('100')
  })

  it('emits saved after valid form submission', async () => {
    const w = mountForm()
    await w.find('[data-testid="amount-input"]').setValue('80')
    await w.find('[data-testid="chip-إيجار"]').trigger('click')
    await w.find('[data-testid="save-btn"]').trigger('click')
    await new Promise(r => setTimeout(r, 10))
    expect(w.emitted('saved')).toBeTruthy()
  })

  it('emits cancel when cancel button is clicked', async () => {
    const w = mountForm()
    await w.find('[data-testid="cancel-btn"]').trigger('click')
    expect(w.emitted('cancel')).toBeTruthy()
  })
})
