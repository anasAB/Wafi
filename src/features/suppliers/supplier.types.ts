export interface Supplier {
  id:             string
  shopId:         string
  name:           string
  phone?:         string
  contactPerson?: string
  address?:       string
  notes?:         string
  deleted:        boolean
  createdAt:      string
  syncStatus:     string
}

export interface SupplierWithStats extends Supplier {
  totalPurchasedUsd: number
  lastReceivedAt:    string | null
}

export interface NewSupplier {
  name:           string
  phone?:         string
  contactPerson?: string
  address?:       string
  notes?:         string
}
