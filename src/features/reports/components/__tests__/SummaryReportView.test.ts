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
})
