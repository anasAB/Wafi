import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import SettlementDraftView from '@/features/staff-ledger/views/SettlementDraftView.vue'
import { db } from '@/data/powersync/db'

describe('SettlementDraftView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getOptional).mockResolvedValue(null)
    vi.mocked(db.getAll).mockResolvedValue([])
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
  })

  it('shows the empty state when there are no ledger movements for the month', async () => {
    const wrapper = mount(SettlementDraftView, { props: { staffId: 'emp-1', periodMonth: '2026-03-01' } })
    await new Promise(r => setTimeout(r, 0))
    expect(wrapper.text()).toContain('لا توجد حركات مالية لهذا الشهر')
  })

  it('disables the Finalize button until a settlement currency is chosen', async () => {
    const wrapper = mount(SettlementDraftView, { props: { staffId: 'emp-1', periodMonth: '2026-03-01' } })
    await new Promise(r => setTimeout(r, 0))
    const finalizeBtn = wrapper.find('[data-testid="finalize-button"]')
    expect(finalizeBtn.attributes('disabled')).toBeDefined()
  })

  it('shows a confirmation dialog before calling finalize', async () => {
    const wrapper = mount(SettlementDraftView, { props: { staffId: 'emp-1', periodMonth: '2026-03-01' } })
    await new Promise(r => setTimeout(r, 0))
    await wrapper.find('[data-testid="currency-usd"]').trigger('click')
    await wrapper.find('[data-testid="finalize-button"]').trigger('click')
    expect(wrapper.text()).toContain('لا يمكن التعديل عليها لاحقاً') // "cannot be edited later"
  })
})
