// One editable row while building a receiving.
export interface ReceivingLine {
  productId:      string
  productName:    string
  currentCostUsd: number   // product's standing cost_price_usd (for the toggle prompt)
  qtyReceived:    number
  unitCostUsd:    number    // cost entered for THIS delivery
  updateCost:     boolean   // update product.cost_price_usd on confirm
}

// A saved receiving header (history list).
export interface Receiving {
  id:                   string
  shopId:               string
  supplierId:           string
  supplierName:         string   // joined for display
  receivedAt:           string
  invoicePhotoUrl?:     string
  totalCostUsd:         number
  exchangeRateAtReceiving: number
  notes?:               string
  staffId?:             string
}

// A saved receiving with its lines, for the read-only detail view.
export interface ReceivingDetailData {
  header: Receiving
  lines: Array<{
    productId:    string
    productName:  string
    qtyReceived:  number
    unitCostUsd:  number
    costUpdated:  boolean
  }>
}
