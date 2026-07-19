import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

vi.mock('@/features/staff-ledger/composables/useStaffSettlement', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/staff-ledger/composables/useStaffSettlement')>()
  return { ...actual, useStaffSettlement: vi.fn(actual.useStaffSettlement) }
})

vi.mock('@/features/staff-ledger/composables/useStaffLedger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/staff-ledger/composables/useStaffLedger')>()
  return { ...actual, useStaffLedger: vi.fn(actual.useStaffLedger) }
})

import SettlementDraftView from '@/features/staff-ledger/views/SettlementDraftView.vue'
import { db } from '@/data/powersync/db'
import { useStaffSettlement } from '@/features/staff-ledger/composables/useStaffSettlement'
import { useStaffLedger } from '@/features/staff-ledger/composables/useStaffLedger'

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

  it('shows the "already finalized elsewhere" message when finalize rejects with a unique-constraint style error', async () => {
    const actual = vi.mocked(useStaffSettlement).getMockImplementation()!()
    vi.mocked(useStaffSettlement).mockReturnValueOnce({
      ...actual,
      finalize: vi.fn().mockRejectedValue(
        new Error('UNIQUE constraint failed: staff_settlements.staff_id, staff_settlements.period_month'),
      ),
    })

    const wrapper = mount(SettlementDraftView, { props: { staffId: 'emp-1', periodMonth: '2026-03-01' } })
    await new Promise(r => setTimeout(r, 0))
    await wrapper.find('[data-testid="currency-usd"]').trigger('click')
    await wrapper.find('[data-testid="finalize-button"]').trigger('click')
    await wrapper.find('[data-testid="confirm-finalize-button"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))

    expect(wrapper.find('[data-testid="conflict-notice"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('تم إغلاق هذه التسوية بالفعل على جهاز آخر')
    expect(wrapper.find('[data-testid="finalize-error-notice"]').exists()).toBe(false)
  })

  it('shows a generic finalize-failed message (not the conflict message) for an unrelated finalize error', async () => {
    const actual = vi.mocked(useStaffSettlement).getMockImplementation()!()
    vi.mocked(useStaffSettlement).mockReturnValueOnce({
      ...actual,
      finalize: vi.fn().mockRejectedValue(new Error('network request failed')),
    })

    const wrapper = mount(SettlementDraftView, { props: { staffId: 'emp-1', periodMonth: '2026-03-01' } })
    await new Promise(r => setTimeout(r, 0))
    await wrapper.find('[data-testid="currency-usd"]').trigger('click')
    await wrapper.find('[data-testid="finalize-button"]').trigger('click')
    await wrapper.find('[data-testid="confirm-finalize-button"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))

    expect(wrapper.find('[data-testid="conflict-notice"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('تم إغلاق هذه التسوية بالفعل على جهاز آخر')
    expect(wrapper.find('[data-testid="finalize-error-notice"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('تعذر إنهاء التسوية')
  })

  it('does not crash and shows an inline error when applying an amount over the entry remaining balance', async () => {
    const actualLedger = vi.mocked(useStaffLedger).getMockImplementation()!()
    vi.mocked(useStaffLedger).mockReturnValueOnce({
      ...actualLedger,
      getOutstandingEntries: vi.fn().mockResolvedValue({
        usd: [{
          id: 'entry-1',
          shopId: 'shop-1',
          staffId: 'emp-1',
          entryType: 'bonus',
          amountUsd: 10,
          currencyEntered: 'usd',
          lockedRate: null,
          note: null,
          sourceType: null,
          sourceId: null,
          createdByStaffId: 'staff-1',
          settlementId: null,
          clientOperationId: 'op-1',
          createdAt: '2026-03-01T00:00:00.000Z',
        }],
        syp: [],
      }),
    })

    const wrapper = mount(SettlementDraftView, { props: { staffId: 'emp-1', periodMonth: '2026-03-01' } })
    await new Promise(r => setTimeout(r, 0))

    const input = wrapper.find('.apply-input')
    expect(input.exists()).toBe(true)

    await expect(async () => {
      await input.setValue(999)
      await input.trigger('change')
    }).not.toThrow()

    await new Promise(r => setTimeout(r, 0))

    expect(wrapper.find('[data-testid="apply-error-entry-1"]').exists()).toBe(true)
  })

  it('keeps the finalize button disabled when SYP is selected without a rate, and enables it once a rate is entered', async () => {
    const wrapper = mount(SettlementDraftView, { props: { staffId: 'emp-1', periodMonth: '2026-03-01' } })
    await new Promise(r => setTimeout(r, 0))

    await wrapper.find('[data-testid="currency-syp"]').trigger('click')
    let finalizeBtn = wrapper.find('[data-testid="finalize-button"]')
    expect(finalizeBtn.attributes('disabled')).toBeDefined()

    const rateInput = wrapper.find('[data-testid="settlement-rate-input"]')
    expect(rateInput.exists()).toBe(true)
    await rateInput.setValue(15000)

    finalizeBtn = wrapper.find('[data-testid="finalize-button"]')
    expect(finalizeBtn.attributes('disabled')).toBeUndefined()
  })

  it('passes the entered rate as settlementRate when finalizing a SYP settlement', async () => {
    const actual = vi.mocked(useStaffSettlement).getMockImplementation()!()
    const finalizeSpy = vi.fn().mockResolvedValue({})
    vi.mocked(useStaffSettlement).mockReturnValueOnce({
      ...actual,
      finalize: finalizeSpy,
    })

    const wrapper = mount(SettlementDraftView, { props: { staffId: 'emp-1', periodMonth: '2026-03-01' } })
    await new Promise(r => setTimeout(r, 0))

    await wrapper.find('[data-testid="currency-syp"]').trigger('click')
    await wrapper.find('[data-testid="settlement-rate-input"]').setValue(15000)
    await wrapper.find('[data-testid="finalize-button"]').trigger('click')
    await wrapper.find('[data-testid="confirm-finalize-button"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))

    expect(finalizeSpy).toHaveBeenCalledTimes(1)
    const optionsArg = finalizeSpy.mock.calls[0][2]
    expect(optionsArg.settlementCurrency).toBe('syp')
    expect(optionsArg.settlementRate).toBe(15000)
  })

  it('does not crash and shows an inline error when applying an amount over the entry remaining balance for a SYP entry', async () => {
    const actualLedger = vi.mocked(useStaffLedger).getMockImplementation()!()
    vi.mocked(useStaffLedger).mockReturnValueOnce({
      ...actualLedger,
      getOutstandingEntries: vi.fn().mockResolvedValue({
        usd: [],
        syp: [{
          id: 'entry-2',
          shopId: 'shop-1',
          staffId: 'emp-1',
          entryType: 'bonus',
          amountUsd: 10,
          currencyEntered: 'syp',
          lockedRate: 15000,
          note: null,
          sourceType: null,
          sourceId: null,
          createdByStaffId: 'staff-1',
          settlementId: null,
          clientOperationId: 'op-2',
          createdAt: '2026-03-01T00:00:00.000Z',
        }],
      }),
    })

    const wrapper = mount(SettlementDraftView, { props: { staffId: 'emp-1', periodMonth: '2026-03-01' } })
    await new Promise(r => setTimeout(r, 0))

    const input = wrapper.find('.apply-input')
    expect(input.exists()).toBe(true)

    await expect(async () => {
      await input.setValue(999)
      await input.trigger('change')
    }).not.toThrow()

    await new Promise(r => setTimeout(r, 0))

    expect(wrapper.find('[data-testid="apply-error-entry-2"]').exists()).toBe(true)
  })
})
