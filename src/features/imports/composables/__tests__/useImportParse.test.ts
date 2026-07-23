import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { parseArrayBuffer, TEMPLATE_HEADERS } from '../useImportParse'

function workbookBuffer(aoa: unknown[][]): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
}

describe('parseArrayBuffer', () => {
  it('reads headers and rows from the first sheet', () => {
    const buf = workbookBuffer([
      ['الاسم', 'سعر البيع'],
      ['iPhone', 1500],
      ['Cable', 50],
    ])
    const { headers, rawRows } = parseArrayBuffer(buf)
    expect(headers).toEqual(['الاسم', 'سعر البيع'])
    expect(rawRows).toHaveLength(2)
    expect(rawRows[0]).toMatchObject({ 'الاسم': 'iPhone', 'سعر البيع': 1500 })
  })
})

describe('TEMPLATE_HEADERS', () => {
  it('includes name and sale price columns', () => {
    expect(TEMPLATE_HEADERS).toContain('الاسم')
    expect(TEMPLATE_HEADERS).toContain('سعر البيع')
  })
})
