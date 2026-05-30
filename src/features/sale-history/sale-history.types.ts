import type { PaymentMethod } from '@/features/payment/payment.types'

export interface SaleRecord {
  id:                  string
  shopId:              string
  deviceId:            string
  deviceSequence:      number
  displaySaleNumber:   string
  createdAt:           string
  totalUsd:            number
  totalSyp:            number
  exchangeRateAtSale:  number
  paymentMethod:       PaymentMethod
  amountReceived?:     number
  amountReceivedCurrency?: 'USD' | 'SYP'
  changeDue?:          number
  isPending:           boolean
}

export interface SaleLineRecord {
  id:           string
  saleId:       string
  productId:    string
  quantity:     number
  unitPriceUsd: number
  lineTotalUsd: number
}
