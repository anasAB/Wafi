import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

// AuditHistory.vue (rendered by ReturnSheet.vue) imports useAuditLog, which
// imports the real PowerSync db module at module-load time — mock it so no
// real IndexedDB/OPFS setup happens in the test environment, matching the
// convention in OwnerSetupScreen.test.ts.
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('../../composables/useReturnSheet', () => ({
  useReturnSheet: vi.fn(),
}))
vi.mock('../../composables/useReturnReasons', () => ({
  useReturnReasons: () => ({ reasons: { value: [] }, loadReasons: vi.fn() }),
}))

import ReturnSheet from '../ReturnSheet.vue'
import { useReturnSheet } from '../../composables/useReturnSheet'

function stubSheet(confirmImpl: () => Promise<{ warning?: any }>) {
  return {
    lines: ref([{ productId: 'p1', productName: 'قلم', originalQty: 1, alreadyReturnedQty: 0, unitPriceUsd: 10, saleDiscountShareUsd: 0, selected: true, qtyToReturn: 1, restock: true }]),
    refundMethod: ref('cash_usd'),
    reason: ref(''),
    notes: ref(''),
    hasCustomer: ref(false),
    customerName: ref(null),
    refundTotalUsd: ref(10),
    refundTotalSyp: ref(10),
    saleDiscountAppliedUsd: ref(0),
    canConfirm: ref(true),
    load: vi.fn().mockResolvedValue(undefined),
    confirm: confirmImpl,
  }
}

describe('ReturnSheet — WAFI-010 plan-warning handling', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('closes normally when confirm() reports no warning', async () => {
    vi.mocked(useReturnSheet).mockReturnValue(stubSheet(async () => ({})) as any)
    const wrapper = mount(ReturnSheet, { props: { saleId: 'sale-1', saleNumber: '1' } })
    await flushPromises()

    await wrapper.find('.btn-confirm').trigger('click')
    await flushPromises()

    expect(wrapper.emitted('confirmed')).toBeTruthy()
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('does not auto-close and shows a persistent warning when confirm() reports one', async () => {
    vi.mocked(useReturnSheet).mockReturnValue(
      stubSheet(async () => ({ warning: { type: 'plan_requires_manual_review', planStatus: 'active' } })) as any,
    )
    const wrapper = mount(ReturnSheet, { props: { saleId: 'sale-1', saleNumber: '1' } })
    await flushPromises()

    await wrapper.find('.btn-confirm').trigger('click')
    await flushPromises()

    // AppToast is a plain <script setup> component with no explicit `name`
    // option, so findComponent({ name: ... }) can't locate it in this
    // codebase (see SalePanel.test.ts's comment on the same limitation) —
    // assert via the rendered DOM instead.
    expect(wrapper.emitted('confirmed')).toBeTruthy()
    expect(wrapper.emitted('close')).toBeFalsy()
    const toastEl = wrapper.find('.toast--info')
    expect(toastEl.exists()).toBe(true)
    expect(toastEl.text()).toContain('خطة تقسيط')

    // Dismissing the persistent warning toast is the cashier's explicit
    // "close" action — confirms toastAutoDismiss's @dismiss wiring emits
    // 'close' only now, not automatically when the warning toast first appears.
    await wrapper.find('.toast-close').trigger('click')
    expect(wrapper.emitted('close')).toBeTruthy()
  })
})
