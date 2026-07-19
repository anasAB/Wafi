import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

vi.mock('@/features/staff-ledger/composables/useStaffLedger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/staff-ledger/composables/useStaffLedger')>()
  return { ...actual, useStaffLedger: vi.fn(actual.useStaffLedger) }
})

import StaffLedgerView from '@/features/staff-ledger/views/StaffLedgerView.vue'
import { db } from '@/data/powersync/db'
import { useStaffLedger } from '@/features/staff-ledger/composables/useStaffLedger'

describe('StaffLedgerView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('shows the empty state when there are no outstanding entries', async () => {
    vi.mocked(db.getAll).mockResolvedValue([])
    const wrapper = mount(StaffLedgerView, { props: { staffId: 'emp-1' } })
    await wrapper.vm.$nextTick()
    await new Promise(r => setTimeout(r, 0))
    expect(wrapper.text()).toContain('لا توجد حركات مالية') // "No outstanding entries."
  })

  it('renders plain-language labels, never raw entry_type strings', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      { id: '1', shop_id: 'shop-1', staff_id: 'emp-1', entry_type: 'advance', amount_usd: 100, currency_entered: 'usd', locked_rate: null, note: null, source_type: 'manual', source_id: null, created_by_staff_id: 'staff-1', client_operation_id: 'a', settlement_id: null, created_at: '2026-03-01T00:00:00Z' },
    ] as any)
    const wrapper = mount(StaffLedgerView, { props: { staffId: 'emp-1' } })
    await wrapper.vm.$nextTick()
    await new Promise(r => setTimeout(r, 0))
    expect(wrapper.text()).toContain('سلفة') // "Advance" label
    expect(wrapper.text()).not.toContain('advance') // never the raw enum
  })

  it('shows an error message and does not crash or silently close when addLedgerEntry rejects', async () => {
    vi.mocked(db.getAll).mockResolvedValue([])
    const actual = vi.mocked(useStaffLedger).getMockImplementation()!()
    vi.mocked(useStaffLedger).mockReturnValueOnce({
      ...actual,
      addLedgerEntry: vi.fn().mockRejectedValue(new Error('permission denied')),
    })

    const wrapper = mount(StaffLedgerView, {
      props: { staffId: 'emp-1' },
      global: { stubs: { teleport: true } },
    })
    await wrapper.vm.$nextTick()
    await new Promise(r => setTimeout(r, 0))

    await wrapper.find('[data-testid="add-entry-btn"]').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-testid="amount-input"]').setValue(50)

    await wrapper.find('[data-testid="save-btn"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))

    expect(wrapper.find('[data-testid="save-error"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('تعذر حفظ الحركة')
    // add-sheet stays open — not silently closed
    expect(wrapper.find('[data-testid="save-btn"]').exists()).toBe(true)
  })
})
