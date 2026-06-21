import type { FieldMapping, TargetField } from '@/features/imports/import.types'

// Accepted header strings per product field. Matching is EXACT after
// normalization (trim, lowercase, collapse internal whitespace) — predictable
// for auto-detect, with anything unrecognized left null for the user to map by
// hand in the wizard. Arabic canonical headers come first, then common English
// aliases. The Arabic shop name maps to nameAr (the required field); nameEn is
// only filled by an explicit "english name" column.
const FIELD_ALIASES: Record<TargetField, string[]> = {
  nameAr:            ['الاسم', 'اسم', 'اسم المنتج', 'name', 'product name', 'item name', 'item'],
  nameEn:            ['الاسم بالانجليزية', 'الاسم بالإنجليزية', 'english name', 'name en', 'name (en)'],
  barcode:           ['الباركود', 'باركود', 'barcode', 'sku', 'upc', 'ean'],
  category:          ['الفئة', 'التصنيف', 'category', 'type', 'group'],
  salePrice:         ['سعر البيع', 'السعر', 'سعر', 'price', 'sale price', 'selling price', 'retail price'],
  cost:              ['التكلفة', 'سعر التكلفة', 'cost', 'cost price', 'buy price', 'purchase price'],
  currentStock:      ['المخزون الحالي', 'المخزون', 'الكمية الحالية', 'الكمية', 'stock', 'qty', 'quantity', 'current stock', 'on hand'],
  lowStockThreshold: ['حد التنبيه', 'حد المخزون', 'الحد الأدنى', 'low stock', 'low stock threshold', 'reorder level', 'reorder point', 'min stock'],
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, ' ')
}

// normalized alias -> target field. Built once; first declaration wins so an
// alias listed under two fields can't flip-flop.
const ALIAS_TO_FIELD: Map<string, TargetField> = (() => {
  const map = new Map<string, TargetField>()
  for (const field of Object.keys(FIELD_ALIASES) as TargetField[]) {
    for (const alias of FIELD_ALIASES[field]) {
      const key = normalizeHeader(alias)
      if (!map.has(key)) map.set(key, field)
    }
  }
  return map
})()

/**
 * Best-effort detection of which source column feeds each product field. Each
 * matched field holds the ORIGINAL header string (so callers can index a parsed
 * row by it); unrecognized fields stay null for manual mapping. Currencies
 * default to SYP — the common case for Syrian price lists — and are overridden
 * in the wizard. When two headers map to the same field, the first one wins.
 */
export function autoDetectMapping(headers: string[]): FieldMapping {
  const mapping: FieldMapping = {
    nameAr: null, nameEn: null, barcode: null, category: null,
    salePrice: null, cost: null, currentStock: null, lowStockThreshold: null,
    priceCurrency: 'SYP', costCurrency: 'SYP',
  }

  for (const header of headers) {
    const field = ALIAS_TO_FIELD.get(normalizeHeader(header))
    if (field && mapping[field] === null) {
      mapping[field] = header
    }
  }

  return mapping
}
