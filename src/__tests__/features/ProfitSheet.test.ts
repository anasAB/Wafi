import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ProfitSheet from '@/features/dashboard/components/ProfitSheet.vue'

function mountSheet(props = {}) {
  return mount(ProfitSheet, {
    props: {
      revenueUsd: 450,
      cogsUsd: 236,
      expensesUsd: 80,
      profitUsd: 134,
      period: 'today' as const,
      ...props,
    },
    attachTo: document.body,
  })
}

describe('ProfitSheet', () => {
  it('shows all 5 rows with correct values', () => {
    const w = mountSheet()
    expect(w.find('[data-testid="row-revenue"]').text()).toContain('450')
    expect(w.find('[data-testid="row-cogs"]').text()).toContain('236')
    expect(w.find('[data-testid="row-gross"]').text()).toContain('214') // 450 - 236
    expect(w.find('[data-testid="row-expenses"]').text()).toContain('80')
    expect(w.find('[data-testid="row-net"]').text()).toContain('134')
  })

  it('shows net profit in green when positive', () => {
    const w = mountSheet({ profitUsd: 134 })
    expect(w.find('[data-testid="row-net"] .net-value').classes()).toContain('positive')
  })

  it('shows net profit in red when negative', () => {
    const w = mountSheet({ profitUsd: -50, cogsUsd: 0, expensesUsd: 500, revenueUsd: 450 })
    expect(w.find('[data-testid="row-net"] .net-value').classes()).toContain('negative')
  })

  it('shows COGS warning when cogsUsd is 0 and revenue > 0', () => {
    const w = mountSheet({ cogsUsd: 0, revenueUsd: 450 })
    expect(w.find('[data-testid="cogs-warning"]').exists()).toBe(true)
  })

  it('hides COGS warning when cogsUsd > 0', () => {
    const w = mountSheet({ cogsUsd: 100 })
    expect(w.find('[data-testid="cogs-warning"]').exists()).toBe(false)
  })

  it('emits close when backdrop is clicked', async () => {
    const w = mountSheet()
    await w.find('[data-testid="profit-backdrop"]').trigger('click')
    expect(w.emitted('close')).toBeTruthy()
  })
})
