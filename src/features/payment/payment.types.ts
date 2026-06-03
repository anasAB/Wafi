export type PaymentMethod = 'cash_usd' | 'cash_syp' | 'card' | 'credit' | 'split'
export type PaymentState  = 'method-selection' | 'amount-entry' | 'card-confirm' | 'credit-confirm' | 'confirming' | 'confirmed'

export interface SaleLine {
  nameAr:       string
  quantity:     number
  unitPriceUsd: number
  lineTotalUsd: number
}

export interface SplitPaymentEntry {
  method:       'cash_usd' | 'cash_syp' | 'card'
  amountRaw:    number   // as entered by cashier
  currency:     'USD' | 'SYP'
  amountUsd:    number   // converted at exchangeRate
  exchangeRate: number
  changeDue:    number   // 0 unless last entry is overpaid
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
  customerId?:             string
  splitPayments?:          SplitPaymentEntry[]
}
