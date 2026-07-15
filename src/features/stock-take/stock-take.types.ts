export type SessionStatus = 'in_progress' | 'completed' | 'cancelled'

export interface StockTakeSession {
  id:          string
  shopId:      string
  startedAt:   string
  completedAt: string | null
  status:      SessionStatus
  createdBy:   string
  scope:       string | null
}

export interface StockTakeLine {
  id:               string
  sessionId:        string
  productId:        string
  productNameAr:    string
  expectedStock:    number
  countedStock:     number | null
  variance:         number | null
  varianceValueUsd: number | null
}

export type StockTakeSessionRow = {
  id: string; shop_id: string; started_at: string; completed_at: string | null
  status: SessionStatus; created_by: string; scope: string | null
}

export type StockTakeLineRow = {
  id: string; session_id: string; product_id: string; name_ar: string
  expected_stock: number; counted_stock: number | null
  variance: number | null; variance_value_usd: number | null
}
