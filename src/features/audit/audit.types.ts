export type AuditEvent =
  | 'sale.completed'
  | 'sale.deleted'
  | 'return.processed'
  | 'product.created'
  | 'product.updated'
  | 'product.deleted'
  | 'product.price_changed'
  | 'product.imported'
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
  | 'cash_movement.recorded'
  | 'cash_movement.voided'
  | 'stock_take.completed'
  | 'installment_plan.created'
  | 'installment_payment.recorded'
  | 'installment_plan.cancelled'
  | 'sync.dead_letter_discarded'
  | 'category.merged'
  | 'category.deleted_with_reassign'
  | 'sale.discount_applied'
  | 'device.renamed'
  | 'device.deactivated'
  | 'device.reactivated'
  | 'staff_ledger.entry_created'
  | 'staff_settlement.finalized'
  | 'staff_settlement.paid'
  | 'messaging.whatsapp_composed'
  | 'device.registered'
  | 'customer.debt_changed'

export type AuditEntityType =
  | 'sale' | 'return' | 'product' | 'expense'
  | 'customer' | 'stock' | 'shift'
  | 'exchange_rate' | 'settings' | 'staff'
  | 'supplier' | 'receiving' | 'cash_movement'
  | 'installment_plan' | 'stock_take' | 'sync' | 'device' | 'category'
  | 'staff_ledger' | 'staff_settlement' | 'messaging'

/** Where a `messaging.whatsapp_composed` event originated. Distinguishes the
 *  five WhatsApp send sites — the event only records that the app handed off
 *  to WhatsApp, not that the message was actually sent or delivered. */
export type WhatsAppChannel =
  | 'receipt' | 'statement' | 'installment_reminder' | 'daily_digest' | 'support_contact'

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
