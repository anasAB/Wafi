import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import MetricCard from '@/features/dashboard/components/MetricCard.vue'

function mountCard(props = {}) {
  return mount(MetricCard, {
    props: { label: 'الربح', amountUsd: 0, syp: 0, accent: 'gray', ...props },
  })
}

describe('MetricCard', () => {
  it('renders the label', () => {
    const w = mountCard({ label: 'المال الداخل' })
    expect(w.text()).toContain('المال الداخل')
  })

  it('shows positive USD with + prefix and green class for positive accent', () => {
    const w = mountCard({ amountUsd: 214.5, accent: 'green' })
    expect(w.find('[data-testid="amount-usd"]').text()).toContain('+$214.50')
    expect(w.find('[data-testid="amount-usd"]').classes()).toContain('text-green-600')
  })

  it('shows negative USD with − prefix and red class for red accent', () => {
    const w = mountCard({ amountUsd: -32, accent: 'red' })
    expect(w.find('[data-testid="amount-usd"]').text()).toContain('−$32.00')
    expect(w.find('[data-testid="amount-usd"]').classes()).toContain('text-red-600')
  })

  it('shows $0.00 with gray class when amount is zero', () => {
    const w = mountCard({ amountUsd: 0, accent: 'gray' })
    expect(w.find('[data-testid="amount-usd"]').text()).toContain('$0.00')
    expect(w.find('[data-testid="amount-usd"]').classes()).toContain('text-gray-500')
  })

  it('shows SYP secondary value', () => {
    const w = mountCard({ syp: 3_103_000 })
    expect(w.find('[data-testid="amount-syp"]').text()).toContain('3,103,000')
  })

  it('shows warning badge when warningCount > 0', () => {
    const w = mountCard({ warningCount: 5 })
    expect(w.find('[data-testid="warning-badge"]').exists()).toBe(true)
    expect(w.find('[data-testid="warning-badge"]').text()).toContain('5')
  })

  it('hides warning badge when warningCount is 0 or undefined', () => {
    const w = mountCard({ warningCount: 0 })
    expect(w.find('[data-testid="warning-badge"]').exists()).toBe(false)
  })
})
