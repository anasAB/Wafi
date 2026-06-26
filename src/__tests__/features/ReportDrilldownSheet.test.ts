import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { i18n } from '@/i18n'
import ReportDrilldownSheet from '@/features/dashboard/components/ReportDrilldownSheet.vue'

function mountSheet() {
  return mount(ReportDrilldownSheet, {
    global: { plugins: [i18n] },
    props: {
      title: 'تفاصيل يوم 2/6',
      loading: false,
      totals: {
        grossIncomeUsd: 100,
        refundsUsd: 5,
        cogsUsd: 35,
        expensesUsd: 10,
        profitUsd: 50,
      },
      expenses: [
        {
          id: 'e1',
          category: 'إيجار',
          amountUsd: 10,
          expenseDate: '2026-06-02',
          notes: 'إيجار شهري',
          photoUrl: 'https://cdn/rent.jpg',
        },
      ],
    },
  })
}

describe('ReportDrilldownSheet', () => {
  it('renders totals and expense list rows', () => {
    const w = mountSheet()
    expect(w.text()).toContain('تفاصيل يوم 2/6')
    expect(w.text()).toContain('إيجار شهري')
    expect(w.text()).toContain('2026-06-02')
  })

  it('emits close when close button is clicked', async () => {
    const w = mountSheet()
    await w.get('[data-test="drilldown-close"]').trigger('click')
    expect(w.emitted('close')).toHaveLength(1)
  })
})
