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

  // WAFI-054: period-accurate "estimated profit" caveat (replaces the old
  // cogs===0 heuristic, which both missed mixed sales and nagged clean shops).
  it('shows the estimated-profit caveat (with the period count) when profitIsEstimated', () => {
    const w = mountSheet({ profitIsEstimated: true, costlessSalesInPeriod: 3 })
    const caveat = w.find('[data-testid="profit-estimated-caveat"]')
    expect(caveat.exists()).toBe(true)
    expect(caveat.text()).toContain('3')
    expect(w.find('[data-testid="profit-estimated-badge"]').exists()).toBe(true)
  })

  it('hides the caveat when no sale in the period is missing a cost', () => {
    const w = mountSheet({ profitIsEstimated: false, costlessSalesInPeriod: 0 })
    expect(w.find('[data-testid="profit-estimated-caveat"]').exists()).toBe(false)
    expect(w.find('[data-testid="profit-estimated-badge"]').exists()).toBe(false)
  })

  it('hides the caveat when the estimate props are omitted (clean by default)', () => {
    const w = mountSheet()
    expect(w.find('[data-testid="profit-estimated-caveat"]').exists()).toBe(false)
  })

  it('emits fix when the caveat is tapped (tap-through to fix missing costs)', async () => {
    const w = mountSheet({ profitIsEstimated: true, costlessSalesInPeriod: 1 })
    await w.find('[data-testid="profit-estimated-caveat"]').trigger('click')
    expect(w.emitted('fix')).toBeTruthy()
  })

  it('emits close when backdrop is clicked', async () => {
    const w = mountSheet()
    await w.find('[data-testid="profit-backdrop"]').trigger('click')
    expect(w.emitted('close')).toBeTruthy()
  })
})
