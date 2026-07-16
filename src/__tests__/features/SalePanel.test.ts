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
    store.addLine({
      productId: 'p1',
      nameAr: 'تست',
      quantity: 1,
      unitPriceUsd: 10,
      lineTotalUsd: 10,
      availableStock: 10,
    })

    const wrapper = mount(SalePanel)
    await wrapper.find('.clear-btn').trigger('click')

    // AppDialog is not registered with an explicit `name` option (plain
    // <script setup>), so findComponent({ name: ... }) can't locate it.
    // Trigger the real confirm flow via the DOM instead, by its visible label.
    const confirmBtn = wrapper.findAll('button').find(b => b.text().includes('نعم'))
    await confirmBtn?.trigger('click')

    expect(store.lines).toHaveLength(0)
    expect(clearDraftMock).toHaveBeenCalledTimes(1)
  })
})
