export type RefundMethod = 'cash_usd' | 'cash_syp' | 'store_credit' | 'transfer'

export interface ReturnLine {
  productId:          string
  productName:        string
  originalQty:        number   // qty from original sale_line_items
  alreadyReturnedQty: number   // qty already returned in prior returns on this sale
  unitPriceUsd:       number   // snapshot from sale_line_items
  selected:           boolean
  qtyToReturn:        number   // 1 .. (originalQty - alreadyReturnedQty)
  restock:            boolean  // add back to stock on confirm
}

export interface ReturnReason {
  id:        string
  label:     string
  sortOrder: number
}

/** A single returned line, for the read-only return-details view. */
export interface ReturnDetailLine {
  nameAr:       string
  qtyReturned:  number
  unitPriceUsd: number
  restock:      boolean
}

/** One processed return (a sale can have several over time), read-only. */
export interface ReturnDetailRecord {
  id:              string
  createdAt:       string
  refundMethod:    RefundMethod
  refundAmountUsd: number
  refundAmountSyp: number
  reason:          string | null
  notes:           string | null
  lines:           ReturnDetailLine[]
}
