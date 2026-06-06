export enum AuditEvent {
  SALE_COMPLETED               = 'sale.completed',
  SALE_DELETED                 = 'sale.deleted',
  RETURN_PROCESSED             = 'return.processed',
  PRODUCT_CREATED              = 'product.created',
  PRODUCT_UPDATED              = 'product.updated',
  PRODUCT_DELETED              = 'product.deleted',
  PRODUCT_PRICE_CHANGED        = 'product.price_changed',
  EXPENSE_CREATED              = 'expense.created',
  EXPENSE_DELETED              = 'expense.deleted',
  CUSTOMER_CREATED             = 'customer.created',
  CUSTOMER_UPDATED             = 'customer.updated',
  CUSTOMER_DELETED             = 'customer.deleted',
  CUSTOMER_PAYMENT_RECORDED    = 'customer.payment_recorded',
  STOCK_ADJUSTED               = 'stock.adjusted',
  SHIFT_OPENED                 = 'shift.opened',
  SHIFT_CLOSED                 = 'shift.closed',
  EXCHANGE_RATE_CHANGED        = 'exchange_rate.changed',
  SETTINGS_RECEIPT_UPDATED     = 'settings.receipt_updated',
  STAFF_CREATED                = 'staff.created',
  STAFF_DEACTIVATED            = 'staff.deactivated',
  STAFF_PERMISSIONS_CHANGED    = 'staff.permissions_changed',
}

export type AuditEntityType =
  | 'sale' | 'return' | 'product' | 'expense'
  | 'customer' | 'stock' | 'shift'
  | 'exchange_rate' | 'settings' | 'staff'

export interface AuditLog {
  id:         string
  shopId:     string
  staffId:    string | null
  staffName:  string
  event:      AuditEvent
  entityType: AuditEntityType
  entityId:   string | null
  meta:       Record<string, unknown>
  createdAt:  string
}
