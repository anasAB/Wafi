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
})
