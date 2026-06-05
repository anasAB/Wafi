import * as XLSX from 'xlsx'
import type { ExportFormat } from '../export.types'

export function buildWorkbook(
  headers: readonly string[] | string[],
  rows: Record<string, unknown>[],
): XLSX.WorkBook {
  const ws = XLSX.utils.json_to_sheet(rows, { header: headers as string[] })
  ws['!dir'] = 'rtl'
  ws['!cols'] = (headers as string[]).map(() => ({ wch: 20 }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  return wb
}

export function buildAndDownload(
  headers: readonly string[] | string[],
  rows: Record<string, unknown>[],
  filename: string,
  format: ExportFormat,
): void {
  if (rows.length === 0) throw new Error('لا توجد بيانات للتصدير')
  const wb = buildWorkbook(headers, rows)
  if (format === 'xlsx') {
    XLSX.writeFile(wb, filename)
  } else {
    const ws  = wb.Sheets[wb.SheetNames[0]]
    const csv = XLSX.utils.sheet_to_csv(ws)
    const bom = '\uFEFF'
    const blob = new Blob([bom + csv], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }
}
