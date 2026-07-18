import type { AuditLog } from './audit.types'

/**
 * Plain-language Arabic description of an audit event for a shop owner.
 * Single source of truth shared by the full activity log and the per-entity
 * history panel so the two never drift apart.
 */
/** Renders as a plain '—' instead of the literal string "undefined" when a
 *  meta field is missing — happens for legacy rows written before a field was
 *  added, or a malformed/edge-case write. Audit rows are append-only and never
 *  rewritten, so the display layer must tolerate old shapes forever. */
function str(v: unknown): string {
  return typeof v === 'string' && v !== '' ? v : '—'
}
function num(v: unknown): string {
  return typeof v === 'number' && Number.isFinite(v) ? String(v) : '—'
}
function usd(v: unknown): string {
  return typeof v === 'number' && Number.isFinite(v) ? `$${v.toFixed(2)}` : '—'
}

export function eventLabel(entry: AuditLog): string {
  const m = entry.meta
  switch (entry.event) {
    case 'sale.completed':            return `أكمل بيع بقيمة ${usd(m.totalUsd)}`
    case 'sale.deleted':              return `حذف بيع بقيمة ${usd(m.totalUsd)}`
    case 'return.processed':          return `أرجع بضاعة بقيمة ${usd(m.refundUsd)}`
    case 'product.created':           return `أضاف منتج: ${str(m.name)}`
    case 'product.updated':           return `عدّل منتج: ${str(m.name)}`
    case 'product.deleted':           return `حذف منتج: ${str(m.name)}`
    case 'product.price_changed':     return `غيّر سعر ${str(m.name)} من ${usd(m.old_price)} إلى ${usd(m.new_price)}`
    case 'expense.created':           return `أضاف مصروف ${str(m.category)}: ${usd(m.amountUsd)}`
    case 'expense.updated': {
      const changed = Array.isArray(m.changed_fields) ? (m.changed_fields as string[]).join('، ') : ''
      return changed
        ? `عدّل مصروف ${str(m.category)}: ${usd(m.amountUsd)} (${changed})`
        : `عدّل مصروف ${str(m.category)}: ${usd(m.amountUsd)}`
    }
    case 'expense.deleted':           return `حذف مصروف ${str(m.category)}: ${usd(m.amountUsd)}`
    case 'customer.created':          return `أضاف عميل: ${str(m.name)}`
    case 'customer.updated':          return `عدّل عميل: ${str(m.name)}`
    case 'customer.deleted':          return `حذف عميل: ${str(m.name)}`
    case 'customer.payment_recorded': return `سجّل دفعة ${usd(m.amountUsd)}`
    case 'stock.adjusted':            return `عدّل مخزون ${str(m.name)}: ${num(m.old_qty)} ← ${num(m.new_qty)}`
    case 'shift.opened':              return `فتح وردية`
    case 'shift.closed':              return `أغلق وردية`
    case 'shift.force_closed': {
      const actor = (m.actor_name as string) ?? 'المالك'
      return `إغلاق وردية إجبارياً بواسطة ${actor}`
    }
    case 'cash_movement.recorded': {
      const direction = m.direction === 'in' ? 'إدخال' : 'إخراج'
      const amount = Number(m.amount ?? 0)
      const currency = (m.currency as string) ?? ''
      const formattedAmount = currency === 'SYP'
        ? `${amount.toLocaleString('en-US')} ل.س`
        : `$${amount.toFixed(2)}`
      const category = (m.category as string) ?? 'حركة نقدية'
      return `سجّل حركة نقدية (${direction}) ${category}: ${formattedAmount}`
    }
    case 'cash_movement.voided':      return `ألغى حركة نقدية`
    case 'installment_plan.created':
      return `أنشأ خطة تقسيط بقيمة ${usd(m.totalUsd)} (دفعة أولى ${usd(m.downPaymentUsd)}, ${num(m.termCount)} دفعات)`
    case 'installment_payment.recorded':
      return `سجّل دفعة قسط ${usd(m.amountUsd)}`
    case 'installment_plan.cancelled':
      return `ألغى خطة تقسيط`
    case 'exchange_rate.changed':     return `غيّر سعر الصرف من ${num(m.old_rate)} إلى ${num(m.new_rate)}`
    case 'settings.receipt_updated':  return `عدّل إعدادات الفاتورة`
    case 'staff.created':             return `أضاف موظف: ${str(m.name)} (${str(m.role)})`
    case 'staff.updated':             return `عدّل بيانات الموظف: ${str(m.name)}`
    case 'staff.deactivated':         return `عطّل حساب: ${str(m.name)}`
    case 'staff.permissions_changed': return `عدّل صلاحيات: ${str(m.name)}`
    case 'staff.pin_changed':         return `غيّر الرقم السري للموظف: ${str(m.name)}`
    case 'auth.login_failed':         return `محاولة دخول فاشلة: ${str(m.name)}`
    case 'auth.locked_out': {
      const minutes = (m.minutes as number) ?? 0
      return `قفل الحساب بعد محاولات فاشلة: ${str(m.name)} (${minutes} دقيقة)`
    }
    case 'supplier.created':          return `أضاف مورد: ${str(m.name)}`
    case 'supplier.updated':          return `عدّل مورد: ${str(m.name)}`
    case 'receiving.created': {
      const supplierName = (m.supplierName as string) ?? 'مورد غير معروف'
      const totalUsd = (m.totalUsd as number) ?? 0
      const lineCount = (m.lineCount as number) ?? 0
      return `سجّل استلام بضاعة من ${supplierName}: $${totalUsd.toFixed(2)} (${lineCount} أصناف)`
    }
    case 'sync.dead_letter_discarded':
      return `حذف نهائياً معاملة متوقفة عن المزامنة (${str(m.table_name)} — ${str(m.error_message)})`
    case 'operator.switched': {
      const from = (m.from_name as string) ?? 'النظام'
      const to   = (m.to_name as string) ?? 'مستخدم غير معروف'
      return `تبديل المستخدم: من ${from} إلى ${to}`
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

/** Relative Arabic time for audit metadata, e.g. "قبل ساعتين". */
export function formatAuditRelativeTime(iso: string): string {
  const diffMinutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (diffMinutes < 1) return 'الآن'
  if (diffMinutes < 60) return `قبل ${diffMinutes} دقيقة`

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `قبل ${diffHours} ساعة`

  const diffDays = Math.floor(diffHours / 24)
  return `قبل ${diffDays} يوم`
}
