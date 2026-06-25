import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ProfitTrendChart from '@/features/dashboard/components/ProfitTrendChart.vue'

const ApexStub = {
  name: 'apexchart',
  props: ['type', 'height', 'series', 'options'],
  template: '<div data-test="apex" />',
}

function mountChart(points: { label: string; profitUsd: number }[]) {
  return mount(ProfitTrendChart, {
    props: { points },
    global: { stubs: { apexchart: ApexStub, VueApexCharts: ApexStub } },
  })
}

describe('ProfitTrendChart', () => {
  it('passes labels and profit values to the chart', () => {
    const w = mountChart([{ label: '1/6', profitUsd: 50 }, { label: '2/6', profitUsd: -20 }])
    const apex = w.findComponent(ApexStub)
    expect(apex.props('series')[0].data).toEqual([50, -20])
    expect(apex.props('options').xaxis.categories).toEqual(['1/6', '2/6'])
  })

  it('configures a color range so negatives are red and positives green', () => {
    const w = mountChart([{ label: '1/6', profitUsd: 50 }])
    const apex = w.findComponent(ApexStub)
    const ranges = apex.props('options').plotOptions.bar.colors.ranges
    const neg = ranges.find((r: any) => r.to <= 0)
    const pos = ranges.find((r: any) => r.from >= 0)
    expect(neg.color.toUpperCase()).toContain('EF4444')   // red
    expect(pos.color.toUpperCase()).toContain('22C55E')   // green
  })
})
