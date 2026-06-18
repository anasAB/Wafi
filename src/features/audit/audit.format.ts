import type { AuditLog } from './audit.types'

/**
 * Plain-language Arabic description of an audit event for a shop owner.
 * Single source of truth shared by the full activity log and the per-entity
 * history panel so the two never drift apart.
 */
export function eventLabel(entry: AuditLog): string {
  const m = entry.meta
  switch (entry.event) {
    case 'sale.completed':            return `أكمل بيع بقيمة $${(m.totalUsd as number)?.toFixed(2)}`
    case 'sale.deleted':              return `حذف بيع بقيمة $${(m.totalUsd as number)?.toFixed(2)}`
    case 'return.processed':          return `أرجع بضاعة بقيمة $${(m.refundUsd as number)?.toFixed(2)}`
    case 'product.created':           return `أضاف منتج: ${m.name}`
    case 'product.updated':           return `عدّل منتج: ${m.name}`
    case 'product.deleted':           return `حذف منتج: ${m.name}`
    case 'product.price_changed':     return `غيّر سعر ${m.name} من $${m.old_price} إلى $${m.new_price}`
    case 'expense.created':           return `أضاف مصروف ${m.category}: $${(m.amountUsd as number)?.toFixed(2)}`
    case 'expense.updated': {
      const changed = Array.isArray(m.changed_fields) ? (m.changed_fields as string[]).join('، ') : ''
      return changed
        ? `عدّل مصروف ${m.category}: $${(m.amountUsd as number)?.toFixed(2)} (${changed})`
        : `عدّل مصروف ${m.category}: $${(m.amountUsd as number)?.toFixed(2)}`
    }
    case 'expense.deleted':           return `حذف مصروف ${m.category}: $${(m.amountUsd as number)?.toFixed(2)}`
    case 'customer.created':          return `أضاف عميل: ${m.name}`
    case 'customer.updated':          return `عدّل عميل: ${m.name}`
    case 'customer.deleted':          return `حذف عميل: ${m.name}`
    case 'customer.payment_recorded': return `سجّل دفعة $${(m.amountUsd as number)?.toFixed(2)}`
    case 'stock.adjusted':            return `عدّل مخزون ${m.name}: ${m.old_qty} ← ${m.new_qty}`
    case 'shift.opened':              return `فتح وردية`
    case 'shift.closed':              return `أغلق وردية`
    case 'exchange_rate.changed':     return `غيّر سعر الصرف من ${m.old_rate} إلى ${m.new_rate}`
    case 'settings.receipt_updated':  return `عدّل إعدادات الفاتورة`
    case 'staff.created':             return `أضاف موظف: ${m.name} (${m.role})`
    case 'staff.deactivated':         return `عطّل حساب: ${m.name}`
    case 'staff.permissions_changed': return `عدّل صلاحيات: ${m.name}`
    case 'supplier.created':          return `أضاف مورد: ${m.name}`
    case 'supplier.updated':          return `عدّل مورد: ${m.name}`
    case 'receiving.created': {
      const supplierName = (m.supplierName as string) ?? 'مورد غير معروف'
      const totalUsd = (m.totalUsd as number) ?? 0
      const lineCount = (m.lineCount as number) ?? 0
      return `سجّل استلام بضاعة من ${supplierName}: $${totalUsd.toFixed(2)} (${lineCount} أصناف)`
    }
    default:                          return entry.event
  }
}

/** Short Arabic (Syria) date/time, e.g. "١٥ يونيو ١٠:٤٥ ص". */
export function formatAuditTime(iso: string): string {
  return new Intl.DateTimeFormat('ar-SY', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso))
}
