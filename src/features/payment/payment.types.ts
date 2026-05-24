export type PaymentMethod = 'cash_usd' | 'cash_syp' | 'card'
export type PaymentState  = 'method-selection' | 'amount-entry' | 'confirming' | 'confirmed'

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
}
