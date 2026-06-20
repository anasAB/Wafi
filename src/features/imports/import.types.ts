export type PriceCurrency = 'USD' | 'SYP'

export interface CanonicalRow {
  nameAr:             string
  nameEn:             string | null
  barcode:            string | null
  category:           string | null
  salePriceRaw:       number | null   // in the file's chosen price currency
  costRaw:            number | null   // in the file's chosen cost currency
  currentStock:       number | null
  lowStockThreshold:  number | null
}

export type RowStatusKind = 'import' | 'skip' | 'error'

export interface RowStatus {
  index:   number          // 1-based source row number (header is row 0)
  kind:    RowStatusKind
  reason:  string | null   // why skipped / errored
  flags:   string[]        // e.g. ['no-cost']
  row:     CanonicalRow
}

export type TargetField =
  | 'nameAr' | 'nameEn' | 'barcode' | 'category'
  | 'salePrice' | 'cost' | 'currentStock' | 'lowStockThreshold'

export interface FieldMapping {
  nameAr:            string | null
  nameEn:            string | null
  barcode:           string | null
  category:          string | null
  salePrice:         string | null
  cost:              string | null
  currentStock:      string | null
  lowStockThreshold: string | null
  priceCurrency:     PriceCurrency
  costCurrency:      PriceCurrency
}

export interface ImportResult {
  inserted: number
  skipped:  number
  errored:  number
  statuses: RowStatus[]
}
