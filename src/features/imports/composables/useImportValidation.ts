import { normalizeText, normalizeNumber } from '../lib/normalize'
import type { CanonicalRow, FieldMapping, RowStatus } from '../import.types'

function cell(raw: Record<string, unknown>, header: string | null): unknown {
  return header ? raw[header] : undefined
}

export function buildCanonicalRows(
  rawRows: Record<string, unknown>[],
  m: FieldMapping,
): CanonicalRow[] {
  return rawRows.map((raw) => ({
    nameAr:            normalizeText(cell(raw, m.nameAr)),
    nameEn:            normalizeText(cell(raw, m.nameEn)) || null,
    barcode:           normalizeText(cell(raw, m.barcode)) || null,
    category:          normalizeText(cell(raw, m.category)) || null,
    salePriceRaw:      normalizeNumber(cell(raw, m.salePrice)),
    costRaw:           normalizeNumber(cell(raw, m.cost)),
    currentStock:      normalizeNumber(cell(raw, m.currentStock)),
    lowStockThreshold: normalizeNumber(cell(raw, m.lowStockThreshold)),
  }))
}

export function validateRows(
  rows: CanonicalRow[],
  existingBarcodes: Set<string>,
): RowStatus[] {
  const seenInFile = new Set<string>()
  return rows.map((row, i) => {
    const flags: string[] = []
    const base = { index: i + 1, flags, row }

    if (!row.nameAr) return { ...base, kind: 'error' as const, reason: 'الاسم مفقود' }
    if (row.salePriceRaw === null || row.salePriceRaw <= 0)
      return { ...base, kind: 'error' as const, reason: 'سعر البيع مفقود أو غير صالح' }
    if (row.currentStock !== null && row.currentStock < 0)
      return { ...base, kind: 'error' as const, reason: 'الكمية سالبة' }

    if (row.barcode) {
      if (existingBarcodes.has(row.barcode))
        return { ...base, kind: 'skip' as const, reason: 'الباركود موجود مسبقاً' }
      if (seenInFile.has(row.barcode))
        return { ...base, kind: 'skip' as const, reason: 'باركود مكرر في الملف' }
      seenInFile.add(row.barcode)
    }

    if (row.costRaw === null) flags.push('no-cost')
    return { ...base, kind: 'import' as const, reason: null }
  })
}
