import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import MappingStep from '@/features/imports/components/MappingStep.vue'
import type { FieldMapping } from '@/features/imports/import.types'

const base: FieldMapping = {
  nameAr: null, nameEn: null, barcode: null, category: null,
  salePrice: null, cost: null, currentStock: null, lowStockThreshold: null,
  priceCurrency: 'SYP', costCurrency: 'SYP',
}

describe('MappingStep', () => {
  it('cannot advance until name and sale price are mapped', () => {
    const wrapper = mount(MappingStep, { props: { headers: ['A', 'B'], modelValue: { ...base } } })
    expect((wrapper.vm as any).canAdvance).toBe(false)
  })
  it('can advance once name + sale price mapped', () => {
    const wrapper = mount(MappingStep, {
      props: { headers: ['A', 'B'], modelValue: { ...base, nameAr: 'A', salePrice: 'B' } },
    })
    expect((wrapper.vm as any).canAdvance).toBe(true)
  })
})
