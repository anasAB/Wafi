import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import StaffLedgerView from '@/features/staff-ledger/views/StaffLedgerView.vue'
import { db } from '@/data/powersync/db'

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
})
