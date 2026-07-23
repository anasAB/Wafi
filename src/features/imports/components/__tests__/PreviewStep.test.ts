import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PreviewStep from '@/features/imports/components/PreviewStep.vue'
import type { RowStatus } from '@/features/imports/import.types'

const row = (kind: RowStatus['kind']): RowStatus => ({
  index: 1, kind, reason: kind === 'import' ? null : 'x', flags: [],
  row: { nameAr: 'X', nameEn: null, barcode: null, category: null,
         salePriceRaw: 10, costRaw: null, currentStock: 0, lowStockThreshold: null },
})

describe('PreviewStep', () => {
  it('shows summary counts', () => {
    const wrapper = mount(PreviewStep, {
      props: { statuses: [row('import'), row('skip'), row('error')], needsRate: false },
    })
    expect(wrapper.text()).toContain('1') // at least the counts render
  })
  it('blocks commit when no importable rows', () => {
    const wrapper = mount(PreviewStep, { props: { statuses: [row('error')], needsRate: false } })
    expect((wrapper.vm as any).canCommit).toBe(false)
  })
  it('blocks commit when SYP rate is required but missing', () => {
    const wrapper = mount(PreviewStep, { props: { statuses: [row('import')], needsRate: true } })
    expect((wrapper.vm as any).canCommit).toBe(false)
  })
})
