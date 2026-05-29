export type PaymentMethod = 'cash_usd' | 'cash_syp' | 'card'
export type PaymentState  = 'method-selection' | 'amount-entry' | 'card-confirm' | 'confirming' | 'confirmed'

export interface SaleLine {
  nameAr:       string
  quantity:     number
  unitPriceUsd: number
  lineTotalUsd: number
}

export interface CompletedSale {
  saleId:                  string
  displaySaleNumber:       string
  totalUsd:                number
  totalSyp:                number
  exchangeRateAtSale:      number
  paymentMethod:           PaymentMethod
  amountReceived?:         number
  amountReceivedCurrency?: 'USD' | 'SYP'
  changeDue?:              number
  createdAt:               string
  lines:                   SaleLine[]
}
