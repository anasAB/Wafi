import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import SummaryReportView from '../SummaryReportView.vue'

describe('SummaryReportView', () => {
  it('renders every metric label and value', () => {
    const wrapper = mount(SummaryReportView, {
      props: { section: { type: 'summary', title: 'Totals', metrics: [{ label: 'Revenue', value: 100, unit: 'USD' }], visibility: 'shop' } },
    })
    expect(wrapper.text()).toContain('Totals')
    expect(wrapper.text()).toContain('Revenue')
    expect(wrapper.text()).toContain('100')
    expect(wrapper.text()).toContain('USD')
  })

  it('I3: rounds a USD-unit metric value to 2 decimal places instead of a raw float', () => {
    const wrapper = mount(SummaryReportView, {
      props: { section: { type: 'summary', title: 'Totals', metrics: [{ label: 'Average basket', value: 62.499999999999996, unit: 'USD' }], visibility: 'shop' } },
    })
    expect(wrapper.text()).toContain('62.50')
    expect(wrapper.text()).not.toContain('62.499999999999996')
  })

  it('I3: leaves a non-USD metric value untouched', () => {
    const wrapper = mount(SummaryReportView, {
      props: { section: { type: 'summary', title: 'Totals', metrics: [{ label: 'Sales count', value: 42, unit: 'sales' }], visibility: 'shop' } },
    })
    expect(wrapper.text()).toContain('42')
  })
})
