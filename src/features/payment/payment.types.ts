import type { DiscountType } from '@/features/pos/discounts'
import type { SaleDiscount } from '@/store/sale.store'

export type PaymentMethod = 'cash_usd' | 'cash_syp' | 'card' | 'credit' | 'split' | 'installment'
export type PaymentState  = 'method-selection' | 'amount-entry' | 'card-confirm' | 'credit-confirm' | 'installment-confirm' | 'confirming' | 'confirmed'

export interface SaleLine {
  nameAr:       string
  quantity:     number
  unitPriceUsd: number
  lineTotalUsd: number
  /** WAFI-100: carried through from sale.store's SaleLine so usePayment.confirm()
   *  can persist discount fields and log the audit trail after the sale commits. */
  discountType?:        DiscountType
  discountValue?:       number
  discountAmountUsd?:   number
  discountPinApproved?: boolean
  unitCostUsd?:         number
  listPriceUsd?:        number
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
  saleDiscount?:           SaleDiscount | null
}
