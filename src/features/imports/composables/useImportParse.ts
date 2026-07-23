import * as XLSX from 'xlsx'
import { buildWorkbook } from '@/features/exports/composables/useExportFile'

export const TEMPLATE_HEADERS = [
  'الاسم', 'الباركود', 'سعر البيع', 'التكلفة', 'المخزون الحالي', 'حد التنبيه', 'الفئة',
] as const

export function parseArrayBuffer(
  buf: ArrayBuffer,
): { headers: string[]; rawRows: Record<string, unknown>[] } {
  const wb = XLSX.read(buf, { type: 'array' })
  const sheetName = wb.SheetNames[0]
  if (!sheetName) throw new Error('الملف فارغ')
  const ws = wb.Sheets[sheetName]
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false })
  if (aoa.length === 0) throw new Error('الملف فارغ')
  const headers = (aoa[0] as unknown[]).map((h) => String(h ?? '').trim())
  const rawRows: Record<string, unknown>[] = []
  for (let i = 1; i < aoa.length; i++) {
    const cells = aoa[i] as unknown[]
    const row: Record<string, unknown> = {}
    headers.forEach((h, c) => { if (h) row[h] = cells[c] })
    rawRows.push(row)
  }
  if (rawRows.length === 0) throw new Error('لا توجد صفوف بيانات في الملف')
  return { headers, rawRows }
}

export async function parseFile(
  file: File,
): Promise<{ headers: string[]; rawRows: Record<string, unknown>[] }> {
  return parseArrayBuffer(await file.arrayBuffer())
}

export function downloadTemplate(): void {
  const wb = buildWorkbook(TEMPLATE_HEADERS as unknown as string[], [])
  XLSX.writeFile(wb, 'wafi-products-template.xlsx')
}
