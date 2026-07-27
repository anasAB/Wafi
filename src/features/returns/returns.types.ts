export type RefundMethod = 'cash_usd' | 'cash_syp' | 'store_credit' | 'transfer'

export interface ReturnLine {
  productId:          string
  productName:        string
  originalQty:        number   // qty from original sale_line_items
  alreadyReturnedQty: number   // qty already returned in prior returns on this sale
  unitPriceUsd:       number   // snapshot from sale_line_items (net of any per-line discount)
  /** WAFI-011 — this line's per-unit share of the sale's whole-cart discount,
   *  prorated by this line's share of the original cart total. 0 when the sale
   *  had no sale-level discount. */
  saleDiscountShareUsd: number
  selected:           boolean
  qtyToReturn:        number   // 1 .. (originalQty - alreadyReturnedQty)
  restock:            boolean  // add back to stock on confirm
  /** WAFI-101 — open-item line (no catalog product): restock is never offered. */
  isOpenItem?:        boolean
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
