export type AdjustmentReason = 'stocktake' | 'damaged' | 'lost' | 'other' | 'sale'

export interface StockAdjustment {
  id:        string
  productId: string
  oldValue:  number
  newValue:  number
  reason:    AdjustmentReason
  notes?:    string
  createdAt: string
  deviceId:  string
}
