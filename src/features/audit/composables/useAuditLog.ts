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

// audit_log.meta was JSONB in Postgres against a TEXT column on the client
// (migration 031 fixed this), which double-encoded the JSON string on every
// sync round-trip: JSON.parse would yield a *string* holding the JSON text
// instead of the parsed object. Parse twice when that happens so any row
// synced before a device picks up 031's backfill still renders correctly.
function parseMeta(raw: string | null): Record<string, unknown> {
  let value: unknown = JSON.parse(raw ?? '{}')
  if (typeof value === 'string') value = JSON.parse(value)
  return (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
}

function rowToAuditLog(r: AuditRow): AuditLog {
  return {
    id: r.id, shopId: r.shop_id, staffId: r.staff_id,
    staffName: r.staff_name, event: r.event as AuditEvent,
    entityType: r.entity_type as AuditEntityType,
    entityId: r.entity_id,
    meta: parseMeta(r.meta),
    createdAt: r.created_at,
  }
}

type ReceivingMetaHydrationRow = {
  id: string
  supplier_name: string
  total_cost_usd: number
  line_count: number
}

type ReceivingLineHydrationRow = {
  receiving_id: string
  product_id: string
  product_name: string
  qty_received: number
  unit_cost_usd: number
  cost_updated: number
}

type ReceivingAuditLineItem = {
  productId: string
  productName: string
  qtyReceived: number
  unitCostUsd: number
  lineTotalUsd: number
  costUpdated: boolean
}

function hasReceivingMeta(entry: AuditLog): boolean {
  if (entry.event !== 'receiving.created') return true
  const m = entry.meta
  const hasSupplier = typeof m.supplierName === 'string' && m.supplierName.trim() !== ''
  const hasTotal = typeof m.totalUsd === 'number' && Number.isFinite(m.totalUsd)
  const hasLineCount = typeof m.lineCount === 'number' && Number.isFinite(m.lineCount)
  return hasSupplier && hasTotal && hasLineCount
}

function hasReceivingLineItems(entry: AuditLog): boolean {
  if (entry.event !== 'receiving.created') return true
  return Array.isArray(entry.meta.lineItems)
}

async function hydrateReceivingMeta(entries: AuditLog[], shopId: string): Promise<AuditLog[]> {
  const missing = entries.filter(
    e => e.event === 'receiving.created' && (!hasReceivingMeta(e) || !hasReceivingLineItems(e)),
  )
  if (!missing.length) return entries

  const ids = missing.map(e => e.entityId).filter((id): id is string => Boolean(id))
  if (!ids.length) return entries

  const placeholders = ids.map(() => '?').join(',')
  const rows = await db.getAll<ReceivingMetaHydrationRow>(
    `SELECT sr.id,
            COALESCE(s.name, 'مورد غير معروف') AS supplier_name,
            COALESCE(sr.total_cost_usd, 0) AS total_cost_usd,
            COALESCE(COUNT(li.id), 0) AS line_count
     FROM stock_receivings sr
     LEFT JOIN suppliers s ON s.id = sr.supplier_id
     LEFT JOIN stock_receiving_line_items li ON li.receiving_id = sr.id
     WHERE sr.shop_id = ? AND sr.id IN (${placeholders})
     GROUP BY sr.id, s.name, sr.total_cost_usd`,
    [shopId, ...ids],
  )

  const lineRows = await db.getAll<ReceivingLineHydrationRow>(
    `SELECT li.receiving_id,
            li.product_id,
            COALESCE(p.name_ar, '—') AS product_name,
            COALESCE(li.qty_received, 0) AS qty_received,
            COALESCE(li.unit_cost_usd, 0) AS unit_cost_usd,
            COALESCE(li.cost_updated, 0) AS cost_updated
     FROM stock_receiving_line_items li
     LEFT JOIN products p ON p.id = li.product_id
     WHERE li.shop_id = ? AND li.receiving_id IN (${placeholders})`,
    [shopId, ...ids],
  )

  const byId = new Map(rows.map(r => [r.id, r]))
  const linesByReceivingId = new Map<string, ReceivingAuditLineItem[]>()

  for (const row of lineRows) {
    const line: ReceivingAuditLineItem = {
      productId: row.product_id,
      productName: row.product_name,
      qtyReceived: Number(row.qty_received ?? 0),
      unitCostUsd: Number(row.unit_cost_usd ?? 0),
      lineTotalUsd: Number(row.qty_received ?? 0) * Number(row.unit_cost_usd ?? 0),
      costUpdated: Number(row.cost_updated ?? 0) === 1,
    }
    const current = linesByReceivingId.get(row.receiving_id)
    if (current) {
      current.push(line)
    } else {
      linesByReceivingId.set(row.receiving_id, [line])
    }
  }

  return entries.map((entry) => {
    if (entry.event !== 'receiving.created' || (hasReceivingMeta(entry) && hasReceivingLineItems(entry))) {
      return entry
    }
    const id = entry.entityId
    if (!id) return entry
    const row = byId.get(id)
    const hydratedLineItems = linesByReceivingId.get(id) ?? []

    if (!row) {
      if (hasReceivingLineItems(entry)) return entry
      return {
        ...entry,
        meta: {
          ...entry.meta,
          lineItems: hydratedLineItems,
        },
      }
    }

    return {
      ...entry,
      meta: {
        ...entry.meta,
        supplierName: row.supplier_name,
        totalUsd: Number(row.total_cost_usd ?? 0),
        lineCount: Number(row.line_count ?? 0),
        lineItems: hasReceivingLineItems(entry)
          ? (entry.meta.lineItems as unknown[])
          : hydratedLineItems,
      },
    }
  })
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
    const parsed = rows.map(rowToAuditLog)
    entries.value = await hydrateReceivingMeta(parsed, device.shopId)
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
    const parsed = rows.map(rowToAuditLog)
    if (entityType !== 'receiving') return parsed
    return hydrateReceivingMeta(parsed, device.shopId)
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

  const logStockTakeCompleted = (
    sessionId: string, linesAdjusted: number, totalShrinkageUsd: number,
  ) => _log('stock_take.completed', 'stock_take', sessionId,
            { linesAdjusted, totalShrinkageUsd })

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
    receivingId: string,
    supplierName: string,
    totalUsd: number,
    lineCount: number,
    lineItems?: ReceivingAuditLineItem[],
  ) => _log('receiving.created', 'receiving', receivingId,
            {
              supplierName,
              totalUsd,
              lineCount,
              ...(lineItems ? { lineItems } : {}),
            })

  // Switching the active operator is an accountability event (no shift change).
  // Entity is the staff switched TO; meta carries both sides for the log sentence.
  const logOperatorSwitched = (
    fromStaffId: string | null, fromName: string | null,
    toStaffId: string, toName: string,
  ) => _log('operator.switched', 'staff', toStaffId,
            { from_staff_id: fromStaffId, from_name: fromName,
              to_staff_id: toStaffId, to_name: toName })

  const logInstallmentPlanCreated = (
    planId: string, customerId: string, totalUsd: number, downPaymentUsd: number, termCount: number,
  ) => _log('installment_plan.created', 'installment_plan', planId,
            { customerId, totalUsd, downPaymentUsd, termCount })

  const logInstallmentPaymentRecorded = (dueId: string, planId: string, amountUsd: number) =>
    _log('installment_payment.recorded', 'installment_plan', planId, { dueId, amountUsd })

  const logInstallmentPlanCancelled = (planId: string) =>
    _log('installment_plan.cancelled', 'installment_plan', planId, {})

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
    logStockTakeCompleted,
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
    logInstallmentPlanCreated,
    logInstallmentPaymentRecorded,
    logInstallmentPlanCancelled,
  }
}
