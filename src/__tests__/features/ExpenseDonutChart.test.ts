import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ExpenseDonutChart from '@/features/dashboard/components/ExpenseDonutChart.vue'

const ApexStub = {
  name: 'apexchart',
  props: ['type', 'height', 'series', 'options'],
  template: '<div />',
}

describe('ExpenseDonutChart', () => {
  it('renders donut with center total formatter and emits category-select', async () => {
    const w = mount(ExpenseDonutChart, {
      props: {
        slices: [
          { category: 'إيجار', totalUsd: 100 },
          { category: 'كهرباء', totalUsd: 50 },
        ],
        totalUsd: 150,
      },
      global: { stubs: { apexchart: ApexStub, VueApexCharts: ApexStub } },
    })

    const apex = w.findComponent(ApexStub)
    expect(apex.props('type')).toBe('donut')
    expect(apex.props('series')).toEqual([100, 50])
    expect(apex.props('options').plotOptions.pie.donut.labels.total.formatter()).toBe('$150.00')

    const onSelect = apex.props('options').chart.events.dataPointSelection
    onSelect({}, {}, { dataPointIndex: 1 })
    await w.vm.$nextTick()

    expect(w.emitted('category-select')).toEqual([['كهرباء']])
  })
})
