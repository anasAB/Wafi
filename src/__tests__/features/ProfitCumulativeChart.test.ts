import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ProfitCumulativeChart from '@/features/dashboard/components/ProfitCumulativeChart.vue'

const ApexStub = {
  name: 'apexchart',
  props: ['type', 'height', 'series', 'options'],
  template: '<div data-test="apex" />',
}

function mountChart(points: { label: string; profitUsd: number; bucketKey?: string }[]) {
  return mount(ProfitCumulativeChart, {
    props: { points },
    global: { stubs: { apexchart: ApexStub, VueApexCharts: ApexStub } },
  })
}

describe('ProfitCumulativeChart', () => {
  it('converts point profits into a running cumulative area series', () => {
    const w = mountChart([
      { label: '1/6', profitUsd: 50, bucketKey: '2026-06-01' },
      { label: '2/6', profitUsd: 108, bucketKey: '2026-06-02' },
      { label: '3/6', profitUsd: -20, bucketKey: '2026-06-03' },
    ])
    const apex = w.findComponent(ApexStub)
    expect(apex.props('type')).toBe('area')
    expect(apex.props('options').xaxis.type).toBe('datetime')
    expect(apex.props('series')[0].data).toEqual([
      { x: new Date('2026-06-01T00:00:00').getTime(), y: 50 },
      { x: new Date('2026-06-02T00:00:00').getTime(), y: 158 },
      { x: new Date('2026-06-03T00:00:00').getTime(), y: 138 },
    ])
  })

  it('emits point-select when a data point is selected', async () => {
    const w = mountChart([
      { label: '1/6', profitUsd: 20, bucketKey: '2026-06-01' },
      { label: '2/6', profitUsd: 40, bucketKey: '2026-06-02' },
    ])
    const apex = w.findComponent(ApexStub)
    const handler = apex.props('options').chart.events.dataPointSelection
    handler({}, {}, { dataPointIndex: 1 })
    await w.vm.$nextTick()
    expect(w.emitted('point-select')).toEqual([[1]])
  })

  it('shows cumulative and daily profit in tooltip content', () => {
    const w = mountChart([
      { label: '19/6', profitUsd: 0, bucketKey: '2026-06-19' },
      { label: '20/6', profitUsd: 150, bucketKey: '2026-06-20' },
    ])
    const apex = w.findComponent(ApexStub)
    const tooltip = apex.props('options').tooltip.custom({ dataPointIndex: 0 })

    expect(tooltip).toContain('الإجمالي التراكمي')
    expect(tooltip).toContain('ربح اليوم')
    expect(tooltip).toContain('$0')
  })
})
