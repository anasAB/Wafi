import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { i18n } from '@/i18n'
import TopExpensesList from '@/features/dashboard/components/TopExpensesList.vue'

function mountList(selectedCategory: string | null = null) {
  return mount(TopExpensesList, {
    global: { plugins: [i18n] },
    props: {
      selectedCategory,
      entries: [
        {
          id: 'e2',
          category: 'كهرباء',
          amountUsd: 50,
          expenseDate: '2026-06-02',
          description: 'فاتورة كهرباء',
        },
        {
          id: 'e1',
          category: 'إيجار',
          amountUsd: 100,
          expenseDate: '2026-06-01',
          description: 'إيجار محل',
        },
      ],
    },
  })
}

describe('TopExpensesList', () => {
  it('renders rows and amounts', () => {
    const w = mountList()
    expect(w.text()).toContain('إيجار محل')
    expect(w.text()).toContain('فاتورة كهرباء')
    expect(w.text()).toContain('$100.00')
  })

  it('shows clear filter control and emits clear-filter', async () => {
    const w = mountList('إيجار')
    expect(w.find('[data-test="clear-expense-filter"]').exists()).toBe(true)
    await w.get('[data-test="clear-expense-filter"]').trigger('click')
    expect(w.emitted('clear-filter')).toHaveLength(1)
  })
})
