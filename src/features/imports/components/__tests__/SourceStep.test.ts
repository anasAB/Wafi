import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import * as XLSX from 'xlsx'
import SourceStep from '@/features/imports/components/SourceStep.vue'

function file(aoa: unknown[][]): File {
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'S')
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  const f = new File([buf], 'p.xlsx')
  // jsdom File lacks arrayBuffer in some versions — polyfill for the test
  ;(f as any).arrayBuffer = async () => buf
  return f
}

describe('SourceStep', () => {
  beforeEach(() => vi.clearAllMocks())

  it('emits parsed data after a valid file is selected', async () => {
    const wrapper = mount(SourceStep)
    const f = file([['الاسم', 'سعر البيع'], ['iPhone', 1500]])
    await (wrapper.vm as any).handleFile(f)
    const emitted = wrapper.emitted('parsed')
    expect(emitted).toBeTruthy()
    expect((emitted![0][0] as any).headers).toEqual(['الاسم', 'سعر البيع'])
  })

  it('shows an error message for an empty file', async () => {
    const wrapper = mount(SourceStep)
    await (wrapper.vm as any).handleFile(file([[]]))
    expect(wrapper.text()).toContain('الملف')
  })
})
