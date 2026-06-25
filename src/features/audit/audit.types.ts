export type AuditEvent =
  | 'sale.completed'
  | 'sale.deleted'
  | 'return.processed'
  | 'product.created'
  | 'product.updated'
  | 'product.deleted'
  | 'product.price_changed'
  | 'expense.created'
  | 'expense.updated'
  | 'expense.deleted'
  | 'customer.created'
  | 'customer.updated'
  | 'customer.deleted'
  | 'customer.payment_recorded'
  | 'stock.adjusted'
  | 'shift.opened'
  | 'shift.closed'
  | 'shift.force_closed'
  | 'exchange_rate.changed'
  | 'settings.receipt_updated'
  | 'staff.created'
  | 'staff.updated'
  | 'staff.deactivated'
  | 'staff.permissions_changed'
  | 'staff.pin_changed'
  | 'staff.recovery_codes_generated'
  | 'staff.recovery_code_used'
  | 'auth.login_failed'
  | 'auth.locked_out'
  | 'supplier.created'
  | 'supplier.updated'
  | 'receiving.created'
  | 'operator.switched'

export type AuditEntityType =
  | 'sale' | 'return' | 'product' | 'expense'
  | 'customer' | 'stock' | 'shift'
  | 'exchange_rate' | 'settings' | 'staff'
  | 'supplier' | 'receiving'

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
