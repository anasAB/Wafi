import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import DetailReportView from '../DetailReportView.vue'

describe('DetailReportView', () => {
  it('renders a table with columns and rows', () => {
    const wrapper = mount(DetailReportView, {
      props: {
        section: {
          type: 'detail', title: 'Rows',
          columns: [{ key: 'name', label: 'Name' }, { key: 'total', label: 'Total' }],
          rows: [{ name: 'A', total: 10 }],
          visibility: 'shop',
        },
      },
    })
    expect(wrapper.text()).toContain('Rows')
    expect(wrapper.text()).toContain('Name')
    expect(wrapper.text()).toContain('A')
    expect(wrapper.text()).toContain('10')
  })

  it('renders an empty-state message when rows is empty', () => {
    const wrapper = mount(DetailReportView, {
      props: { section: { type: 'detail', title: 'Rows', columns: [{ key: 'name', label: 'Name' }], rows: [], visibility: 'shop' } },
    })
    expect(wrapper.text()).toContain('لا توجد بيانات')
  })

  it('I3: formats currency-usd columns to 2 decimal places instead of a raw float', () => {
    const wrapper = mount(DetailReportView, {
      props: {
        section: {
          type: 'detail', title: 'Rows',
          columns: [{ key: 'amount', label: 'Amount', format: 'currency-usd' }],
          rows: [{ amount: 62.499999999999996 }],
          visibility: 'shop',
        },
      },
    })
    expect(wrapper.text()).toContain('62.50')
    expect(wrapper.text()).not.toContain('62.499999999999996')
  })

  it('I3: formats date columns to just the date portion', () => {
    const wrapper = mount(DetailReportView, {
      props: {
        section: {
          type: 'detail', title: 'Rows',
          columns: [{ key: 'when', label: 'When', format: 'date' }],
          rows: [{ when: '2026-08-18T14:32:00.000Z' }],
          visibility: 'shop',
        },
      },
    })
    expect(wrapper.text()).toContain('2026-08-18')
    expect(wrapper.text()).not.toContain('14:32:00')
  })

  it('I2: shows a truncation notice when section.truncated is true, and omits it otherwise', () => {
    const truncated = mount(DetailReportView, {
      props: { section: { type: 'detail', title: 'Rows', columns: [{ key: 'name', label: 'Name' }], rows: [{ name: 'A' }], visibility: 'shop', truncated: true } },
    })
    expect(truncated.find('[data-testid="truncated-notice"]').exists()).toBe(true)

    const notTruncated = mount(DetailReportView, {
      props: { section: { type: 'detail', title: 'Rows', columns: [{ key: 'name', label: 'Name' }], rows: [{ name: 'A' }], visibility: 'shop', truncated: false } },
    })
    expect(notTruncated.find('[data-testid="truncated-notice"]').exists()).toBe(false)
  })
})
