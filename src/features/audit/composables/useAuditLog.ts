import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { useSessionStore } from '@/store/session.store'
import type { AuditEvent, AuditEntityType, AuditLog } from '@/features/audit/audit.types'

type AuditRow = {
  id: string; shop_id: string; staff_id: string | null; staff_name: string
  event: string; entity_type: string; entity_id: string | null
  meta: string; created_at: string
}

function rowToAuditLog(r: AuditRow): AuditLog {
  return {
    id: r.id, shopId: r.shop_id, staffId: r.staff_id,
    staffName: r.staff_name, event: r.event as AuditEvent,
    entityType: r.entity_type as AuditEntityType,
    entityId: r.entity_id,
    meta: JSON.parse(r.meta ?? '{}'),
    createdAt: r.created_at,
  }
}

export function useAuditLog() {
  const entries = ref<AuditLog[]>([])
  const device  = useDeviceStore()
  const session = useSessionStore()

  /** Write one audit row. Throws on DB failure — callers decide whether to swallow. */
  async function _write(
    event: AuditEvent,
    entityType: AuditEntityType,
    entityId: string | null,
    meta: Record<string, unknown>,
  ): Promise<void> {
    await db.execute(
      `INSERT INTO audit_log
         (id, shop_id, staff_id, staff_name, event, entity_type, entity_id, meta, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
        device.shopId,
        session.activeStaff?.id   ?? null,
        session.activeStaff?.name ?? 'system',
        event,
        entityType,
        entityId,
        JSON.stringify(meta),
        new Date().toISOString(),
      ],
    )
  }

  // Routine, high-frequency actions (sales, product/customer/expense edits):
  // best-effort. A failed audit write must NEVER block the business action —
  // offline-first, the sale matters more than its log line.
  async function _log(
    event: AuditEvent,
    entityType: AuditEntityType,
    entityId: string | null,
    meta: Record<string, unknown>,
  ): Promise<void> {
    try {
      await _write(event, entityType, entityId, meta)
    } catch (err) {
      console.warn('[useAuditLog] failed to write audit row:', err)
    }
  }

  // Security-sensitive actions (PIN changes, failed logins, lockouts): the log
  // IS the accountability defense, so a failed write must surface rather than
  // vanish. We re-throw so the UI can show it (WAFI-014).
  async function _logSensitive(
    event: AuditEvent,
    entityType: AuditEntityType,
    entityId: string | null,
    meta: Record<string, unknown>,
  ): Promise<void> {
    await _write(event, entityType, entityId, meta)
  }

  async function loadLog(options: {
    startDate: string
    endDate:   string
    staffId?:  string | null
    event?:    string | null
  }): Promise<void> {
    const device = useDeviceStore()
    const params: unknown[] = [device.shopId, options.startDate, options.endDate]
    let sql = `SELECT * FROM audit_log
           WHERE shop_id = ? AND date(created_at) >= ? AND date(created_at) <= ?`
    if (options.staffId) { sql += ' AND staff_id = ?'; params.push(options.staffId) }
    if (options.event)   { sql += ' AND event = ?';    params.push(options.event) }
    sql += ' ORDER BY created_at DESC LIMIT 200'
    const rows = await db.getAll<AuditRow>(sql, params)
    entries.value = rows.map(rowToAuditLog)
  }

  async function loadEntityHistory(
    entityType: string,
    entityId:   string,
  ): Promise<AuditLog[]> {
    const rows = await db.getAll<AuditRow>(
      `SELECT * FROM audit_log
       WHERE entity_type = ? AND entity_id = ?
       ORDER BY created_at DESC LIMIT 50`,
      [entityType, entityId],
    )
    return rows.map(rowToAuditLog)
  }

  // ── Typed helpers ──────────────────────────────────────────────────────────

  const logSaleCompleted = (saleId: string, totalUsd: number, itemCount: number) =>
    _log('sale.completed', 'sale', saleId, { totalUsd, itemCount })

  const logSaleDeleted = (saleId: string, totalUsd: number) =>
    _log('sale.deleted', 'sale', saleId, { totalUsd })

  const logReturnProcessed = (returnId: string, saleId: string, refundUsd: number) =>
    _log('return.processed', 'return', returnId, { saleId, refundUsd })

  const logProductCreated = (productId: string, name: string) =>
    _log('product.created', 'product', productId, { name })

  const logProductUpdated = (productId: string, name: string) =>
    _log('product.updated', 'product', productId, { name })

  const logProductDeleted = (productId: string, name: string) =>
    _log('product.deleted', 'product', productId, { name })

  const logProductPriceChanged = (
    productId: string, name: string, oldPrice: number, newPrice: number,
  ) => _log('product.price_changed', 'product', productId,
            { name, old_price: oldPrice, new_price: newPrice })

  const logExpenseCreated = (expenseId: string, category: string, amountUsd: number) =>
    _log('expense.created', 'expense', expenseId, { category, amountUsd })

  const logExpenseUpdated = (
    expenseId: string,
    category: string,
    amountUsd: number,
    changedFields: string[],
  ) => _log('expense.updated', 'expense', expenseId, { category, amountUsd, changed_fields: changedFields })

  const logExpenseDeleted = (expenseId: string, category: string, amountUsd: number) =>
    _log('expense.deleted', 'expense', expenseId, { category, amountUsd })

  const logCustomerCreated = (customerId: string, name: string) =>
    _log('customer.created', 'customer', customerId, { name })

  const logCustomerUpdated = (customerId: string, name: string) =>
    _log('customer.updated', 'customer', customerId, { name })

  const logCustomerDeleted = (customerId: string, name: string) =>
    _log('customer.deleted', 'customer', customerId, { name })

  const logCustomerPaymentRecorded = (customerId: string, amountUsd: number) =>
    _log('customer.payment_recorded', 'customer', customerId, { amountUsd })

  const logStockAdjusted = (
    productId: string, name: string, oldQty: number, newQty: number,
  ) => _log('stock.adjusted', 'stock', productId,
            { name, old_qty: oldQty, new_qty: newQty })

  const logShiftOpened = (shiftId: string) =>
    _log('shift.opened', 'shift', shiftId, {})

  const logShiftClosed = (shiftId: string) =>
    _log('shift.closed', 'shift', shiftId, {})

  // Force-close (WAFI-065) is an accountability action: the owner closed someone
  // else's abandoned shift without their count. Sensitive (surface write failures),
  // and the actor is passed explicitly because the session operator can differ from
  // the authoriser — or be unset at the login gate (mirrors logPinChanged's actor).
  const logShiftForceClosed = (
    shiftId: string,
    actor: { id: string; name: string },
    note: string,
  ) =>
    _logSensitive('shift.force_closed', 'shift', shiftId,
      { actor_id: actor.id, actor_name: actor.name, note })

  // Routine: recording a movement must not block the action (offline-first), like sales.
  const logCashMovementRecorded = (
    movementId: string,
    direction: 'in' | 'out',
    category: string,
    currency: 'USD' | 'SYP',
    amount: number,
  ) => _log('cash_movement.recorded', 'cash_movement', movementId,
            { direction, category, currency, amount })

  // Sensitive: a void reverses a money record — surface a failed write.
  const logCashMovementVoided = (
    voidMovementId: string,
    originalMovementId: string,
    note: string,
  ) => _logSensitive('cash_movement.voided', 'cash_movement', voidMovementId,
                     { original_id: originalMovementId, note })

  const logExchangeRateChanged = (oldRate: number, newRate: number) =>
    _log('exchange_rate.changed', 'exchange_rate', null,
         { old_rate: oldRate, new_rate: newRate })

  const logReceiptSettingsUpdated = () =>
    _log('settings.receipt_updated', 'settings', null, {})

  const logStaffCreated = (staffId: string, name: string, role: string) =>
    _log('staff.created', 'staff', staffId, { name, role })

  const logStaffDeactivated = (staffId: string, name: string) =>
    _log('staff.deactivated', 'staff', staffId, { name })

  const logStaffUpdated = (staffId: string, name: string) =>
    _log('staff.updated', 'staff', staffId, { name })

  const logStaffPermissionsChanged = (staffId: string, name: string) =>
    _log('staff.permissions_changed', 'staff', staffId, { name })

  // Security events — surface write failures (see _logSensitive).
  //
  // `actor` names WHO changed the PIN, distinct from the target (the entity).
  // On the owner-only edit path the actor is the active operator and is already
  // captured in the row's staff_id/staff_name columns, so it may be omitted.
  // On the WAFI-056 recovery path the shop is locked (no active operator → those
  // columns are 'system'), so the authoriser is passed explicitly and recorded
  // in meta — the only place the actor survives.
  const logPinChanged = (
    staffId: string,
    name: string,
    actor?: { id: string; name: string },
  ) =>
    _logSensitive('staff.pin_changed', 'staff', staffId,
      actor ? { name, actor_id: actor.id, actor_name: actor.name } : { name })

  const logRecoveryCodesGenerated = (staffId: string, name: string) =>
    _logSensitive('staff.recovery_codes_generated', 'staff', staffId, { name })

  const logRecoveryCodeUsed = (staffId: string, name: string) =>
    _logSensitive('staff.recovery_code_used', 'staff', staffId, { name })

  const logLoginFailed = (staffId: string, name: string) =>
    _logSensitive('auth.login_failed', 'staff', staffId, { name })

  const logLockedOut = (staffId: string, name: string, minutes: number) =>
    _logSensitive('auth.locked_out', 'staff', staffId, { name, minutes })

  const logSupplierCreated = (supplierId: string, name: string) =>
    _log('supplier.created', 'supplier', supplierId, { name })

  const logSupplierUpdated = (supplierId: string, name: string) =>
    _log('supplier.updated', 'supplier', supplierId, { name })

  const logReceivingCreated = (
    receivingId: string, supplierName: string, totalUsd: number, lineCount: number,
  ) => _log('receiving.created', 'receiving', receivingId,
            { supplierName, totalUsd, lineCount })

  // Switching the active operator is an accountability event (no shift change).
  // Entity is the staff switched TO; meta carries both sides for the log sentence.
  const logOperatorSwitched = (
    fromStaffId: string | null, fromName: string | null,
    toStaffId: string, toName: string,
  ) => _log('operator.switched', 'staff', toStaffId,
            { from_staff_id: fromStaffId, from_name: fromName,
              to_staff_id: toStaffId, to_name: toName })

  return {
    entries,
    loadLog,
    loadEntityHistory,
    logSaleCompleted,
    logSaleDeleted,
    logReturnProcessed,
    logProductCreated,
    logProductUpdated,
    logProductDeleted,
    logProductPriceChanged,
    logExpenseCreated,
    logExpenseUpdated,
    logExpenseDeleted,
    logCustomerCreated,
    logCustomerUpdated,
    logCustomerDeleted,
    logCustomerPaymentRecorded,
    logStockAdjusted,
    logShiftOpened,
    logShiftClosed,
    logShiftForceClosed,
    logCashMovementRecorded,
    logCashMovementVoided,
    logExchangeRateChanged,
    logReceiptSettingsUpdated,
    logStaffCreated,
    logStaffUpdated,
    logStaffDeactivated,
    logStaffPermissionsChanged,
    logPinChanged,
    logRecoveryCodesGenerated,
    logRecoveryCodeUsed,
    logLoginFailed,
    logLockedOut,
    logSupplierCreated,
    logSupplierUpdated,
    logReceivingCreated,
    logOperatorSwitched,
  }
}
