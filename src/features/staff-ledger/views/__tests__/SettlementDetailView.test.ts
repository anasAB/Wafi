import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

vi.mock('@/features/staff-ledger/composables/useStaffSettlement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/staff-ledger/composables/useStaffSettlement')>()
  return { ...actual, useStaffSettlement: vi.fn(actual.useStaffSettlement) }
})

import SettlementDetailView from '@/features/staff-ledger/views/SettlementDetailView.vue'
import { db } from '@/data/powersync/db'
import { useStaffSettlement } from '@/features/staff-ledger/composables/useStaffSettlement'

const finalizedRow = {
  id: 'settlement-1', shop_id: 'shop-1', staff_id: 'emp-1', settlement_number: '202603-ABC123',
  period_month: '2026-03-01', status: 'finalized', base_salary_usd: 100,
  settlement_currency: 'usd', locked_rate: null, applied_amount_usd: 0, final_amount_usd: 100,
  notes: null, staff_name_snapshot: 'Emp One', staff_role_snapshot: 'cashier',
  finalized_at: '2026-03-01T00:00:00.000Z', paid_at: null, paid_by_staff_id: null,
  payment_method: null, client_operation_id: 'op-1', created_at: '2026-03-01T00:00:00.000Z',
}

describe('SettlementDetailView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getOptional).mockResolvedValue(finalizedRow as any)
  })

  it('shows an error message and does not crash or silently close when markPaid rejects', async () => {
    const actual = vi.mocked(useStaffSettlement).getMockImplementation()!()
    const markPaidMock = vi.fn().mockRejectedValue(new Error('permission denied'))
    vi.mocked(useStaffSettlement).mockReturnValueOnce({
      ...actual,
      markPaid: markPaidMock,
    })

    const wrapper = mount(SettlementDetailView, { props: { settlementId: 'settlement-1', staffId: 'emp-1' } })
    await new Promise(r => setTimeout(r, 0))

    await wrapper.find('[data-testid="mark-paid-button"]').trigger('click')
    await wrapper.find('[data-testid="confirm-paid-button"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))

    expect(markPaidMock).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-testid="mark-paid-error"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('تعذر تسجيل الدفع')
    // dialog stays open — not silently closed
    expect(wrapper.find('[data-testid="confirm-paid-button"]').exists()).toBe(true)
  })
})
