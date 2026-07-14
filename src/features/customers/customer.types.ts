export interface Customer {
  id:         string
  shopId:     string
  name:       string
  phone?:     string
  mobile?:    string
  address?:   string
  deleted:    boolean
  createdAt:  string
  syncStatus: string
  /** Outstanding credit (credit sales − payments − returns). Populated by the
   *  list query; undefined when not computed. */
  balanceUsd?: number
  /** Unsynced credit rows for this customer (credit sales + payments). */
  pendingSyncCount?: number
}

export interface NewCustomer {
  name:     string
  phone?:   string
  mobile?:  string
  address?: string
}

export interface OpenInvoice {
  saleId:        string
  displayNumber: string
  saleDate:      string
  totalUsd:      number
  remainingUsd:  number
  itemsSummary:  string  // e.g. "Samsung A55، كابل HDMI"
}

export interface InvoiceLineItem {
  nameAr:       string
  quantity:     number
  unitPriceUsd: number
  lineTotalUsd: number
}

/** How a credit collection was settled. Only 'cash' enters the cash drawer. */
export type PaymentMethod = 'cash' | 'transfer' | 'usdt' | 'hawala'

export interface PaymentAllocation {
  saleId:                  string
  amountUsd:               number
  currency:                'USD' | 'SYP'
  amountRaw:               number
  method:                  PaymentMethod
  exchangeRateAtPayment?:  number
}

export interface CustomerPayment {
  id:         string
  customerId: string
  saleId:     string
  amountUsd:  number
  currency:   'USD' | 'SYP'
  method:     PaymentMethod | null
  paidAt:     string
  createdAt:  string
}
