import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/features/exchange-rate', () => ({
  useExchangeRate: () => ({ currentRate: { value: 14500 } }),
}))

import RecordPaymentSheet from '@/features/customers/components/RecordPaymentSheet.vue'
import type { OpenInvoice } from '@/features/customers/customer.types'
import { db } from '@/data/powersync/db'

const router = createRouter({
  history: createMemoryHistory(),
  routes: [{ path: '/:p(.*)', component: { template: '<div/>' } }],
})

const invoice1: OpenInvoice = {
  saleId: 's1', displayNumber: '#231', saleDate: '2025-06-02T00:00:00Z',
  totalUsd: 220, remainingUsd: 160, itemsSummary: 'Samsung A55',
}
const invoice2: OpenInvoice = {
  saleId: 's2', displayNumber: '#218', saleDate: '2025-05-28T00:00:00Z',
  totalUsd: 80, remainingUsd: 80, itemsSummary: 'كابل HDMI',
}

function mountSheet(props = {}) {
  const pinia = createPinia()
  pinia.use(piniaPluginPersistedstate)
  return mount(RecordPaymentSheet, {
    props: { customerId: 'c1', customerName: 'أبو خالد', openInvoices: [invoice1, invoice2], ...props },
    global: {
      plugins: [pinia, router],
      stubs: { Teleport: true },
    },
  })
}

describe('RecordPaymentSheet', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
    vi.mocked(db.getOptional).mockResolvedValue({ balance_usd: 0 } as any)
    vi.mocked(db.getAll).mockResolvedValue([])
  })

  it('renders all open invoices', () => {
    const w = mountSheet()
    expect(w.find('[data-testid="invoice-s1"]').exists()).toBe(true)
    expect(w.find('[data-testid="invoice-s2"]').exists()).toBe(true)
  })

  it('confirm button is disabled when no invoices are selected', () => {
    const w = mountSheet()
    expect(w.find('[data-testid="confirm-btn"]').attributes('disabled')).toBeDefined()
  })

  it('selecting an invoice enables the confirm button', async () => {
    const w = mountSheet()
    await w.find('[data-testid="checkbox-s1"]').trigger('click')
    expect(w.find('[data-testid="confirm-btn"]').attributes('disabled')).toBeUndefined()
  })

  it('amount input defaults to remaining on invoice', async () => {
    const w = mountSheet()
    await w.find('[data-testid="checkbox-s1"]').trigger('click')
    const input = w.find('[data-testid="amount-s1"]').element as HTMLInputElement
    expect(parseFloat(input.value)).toBe(160)
  })

  it('emits saved after confirming selected invoices', async () => {
    const w = mountSheet()
    await w.find('[data-testid="checkbox-s1"]').trigger('click')
    await w.find('[data-testid="confirm-btn"]').trigger('click')
    await new Promise(r => setTimeout(r, 20))
    expect(w.emitted('saved')).toBeTruthy()
  })

  it('emits cancel when cancel button clicked', async () => {
    const w = mountSheet()
    await w.find('[data-testid="cancel-btn"]').trigger('click')
    expect(w.emitted('cancel')).toBeTruthy()
  })
})
