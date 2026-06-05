import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { buildWorkbook, buildAndDownload } from '@/features/exports/composables/useExportFile'

describe('buildWorkbook', () => {
  it('creates a workbook with one sheet named Sheet1', () => {
    const wb = buildWorkbook(['الاسم'], [{ 'الاسم': 'أحمد' }])
    expect(wb.SheetNames).toEqual(['Sheet1'])
  })

  it('sets RTL direction on the worksheet', () => {
    const wb = buildWorkbook(['الاسم'], [{ 'الاسم': 'أحمد' }])
    expect(wb.Sheets['Sheet1']['!dir']).toBe('rtl')
  })

  it('writes data rows correctly', () => {
    const wb = buildWorkbook(
      ['المنتج', 'الكمية'],
      [{ 'المنتج': 'تلفزيون', 'الكمية': 3 }],
    )
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['Sheet1'])
    expect(rows).toHaveLength(1)
    expect((rows[0] as Record<string, unknown>)['المنتج']).toBe('تلفزيون')
    expect((rows[0] as Record<string, unknown>)['الكمية']).toBe(3)
  })

  it('sets column widths on the worksheet', () => {
    const wb = buildWorkbook(['الاسم', 'الرصيد'], [{ 'الاسم': 'أحمد', 'الرصيد': 100 }])
    expect(wb.Sheets['Sheet1']['!cols']).toHaveLength(2)
  })
})

describe('buildAndDownload', () => {
  it('throws "لا توجد بيانات للتصدير" when rows is empty', () => {
    expect(() => buildAndDownload(['الاسم'], [], 'test.xlsx', 'xlsx')).toThrow('لا توجد بيانات للتصدير')
  })
})
