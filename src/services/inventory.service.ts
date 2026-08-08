import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { executeBusinessOperation } from '@/composables/executeBusinessOperation'
import { InventoryEventType } from '@/services/events/domainEvent.types'
import { checkLowStockCrossing } from '@/services/notifications/lowStockCheck'
import type { ReceivingLine, Receiving } from '@/features/suppliers/receiving.types'
import type { AdjustmentReason, StockAdjustment } from '@/features/products/product.types'
import type { StockReceivedPayload, InventoryAdjustedPayload } from '@/services/events/domainEvent.types'

/** Structurally identical to useAuditLog.ts's private (unexported) ReceivingAuditLineItem
 *  — duplicated here rather than exported from useAuditLog, so this file still imports
 *  nothing from @/features/audit (which itself imports Vue/Pinia composables elsewhere
 *  in that module). If useAuditLog.ts's shape ever changes, update both. */
export interface ReceivingAuditLineItem {
  productId: string
  productName: string
  qtyReceived: number
  unitCostUsd: number
  lineTotalUsd: number
  costUpdated: boolean
}

/** Narrow audit interface this service needs — implemented by the caller via
 *  useAuditLog(), never imported here. */
export interface ReceiveStockAuditPort {
  logReceivingCreated: (
    receivingId: string, supplierName: string, totalUsd: number, lineCount: number,
    lineItems?: ReceivingAuditLineItem[],
  ) => Promise<void>
}

export interface ReceiveStockInput {
  supplierId: string
  supplierName: string
  lines: ReceivingLine[]
  invoicePhotoUrl: string | null
  notes: string
}

export async function receiveStock(
  shopId: string,
  staffId: string | null,
  input: ReceiveStockInput,
  audit: ReceiveStockAuditPort,
): Promise<Receiving> {
  if (!input.supplierId || input.lines.length === 0 || input.lines.some(l => l.qtyReceived <= 0)) {
    throw new Error('confirm() called without valid state')
  }

  // Current exchange rate (read-only lookup, outside transaction).
  const rateResult = await db.execute(
    `SELECT rate FROM exchange_rates WHERE shop_id = ? ORDER BY set_at DESC LIMIT 1`,
    [shopId],
  )
  const exchangeRate: number = (rateResult as any).rows._array[0]?.rate ?? 1

  const receivingId = uuidv4()
  const now = new Date().toISOString()
  const total = input.lines.reduce(
    (sum, line) => sum + (Number(line.qtyReceived) || 0) * (Number(line.unitCostUsd) || 0),
    0,
  )

  const write = async (): Promise<Receiving> => {
    await db.writeTransaction(async (tx) => {
      await tx.execute(
        `INSERT INTO stock_receivings
           (id, shop_id, supplier_id, received_at, invoice_photo_url, total_cost_usd,
            exchange_rate_at_receiving, notes, staff_id, sync_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [receivingId, shopId, input.supplierId, now, input.invoicePhotoUrl,
         total, exchangeRate, input.notes || null, staffId],
      )

      for (const line of input.lines) {
        await tx.execute(
          `INSERT INTO stock_receiving_line_items
             (id, receiving_id, shop_id, product_id, qty_received, unit_cost_usd, cost_updated, sync_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
          [uuidv4(), receivingId, shopId, line.productId, line.qtyReceived,
           line.unitCostUsd, line.updateCost ? 1 : 0],
        )

        // Increment stock.
        const stockResult = await tx.execute(
          `SELECT current_stock FROM products WHERE id = ?`, [line.productId],
        )
        const oldStock: number = (stockResult as any).rows._array[0]?.current_stock ?? 0
        const newStock = oldStock + line.qtyReceived
        await tx.execute(
          `UPDATE products SET current_stock = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
          [newStock, now, line.productId],
        )
        await checkLowStockCrossing(tx, shopId, line.productId, oldStock, newStock, now)

        // Update standing cost only if toggled AND the cost is real (WAFI-021): a
        // zero/blank unit cost must never overwrite the product's standing cost — that
        // silently wipes margin on every later sale. Past sale_line_items are untouched.
        // WAFI-013: cost_updated_at is stamped unconditionally in this branch (not
        // compared against the old value) — confirming a cost during a receiving is
        // itself the freshness signal, even if the confirmed number happens to equal
        // what was already stored.
        if (line.updateCost && line.unitCostUsd > 0) {
          await tx.execute(
            `UPDATE products SET cost_price_usd = ?, cost_updated_at = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
            [line.unitCostUsd, now, now, line.productId],
          )
        }
      }
    })

    return {
      id: receivingId, shopId, supplierId: input.supplierId, supplierName: input.supplierName,
      receivedAt: now, invoicePhotoUrl: input.invoicePhotoUrl ?? undefined,
      totalCostUsd: total, exchangeRateAtReceiving: exchangeRate,
      notes: input.notes || undefined, staffId: staffId ?? undefined,
    }
  }

  return executeBusinessOperation(write, {
    // WAFI-150 final review (C3): NOT retired. StockReceivedPayload doesn't carry the
    // supplier name or per-line detail (product/qty/unit cost/costUpdated) that this
    // manual call's audit_log meta -- and AuditLogPage.vue's expanded receiving detail
    // view -- both require. Faking that shape from the payload alone is impossible
    // (the data genuinely isn't there), so this call stays manual (documented escape
    // hatch per the design spec) and auditSubscriber.ts's mapEventToAuditEntry maps
    // 'stock.received' to null so the subscriber does not double-log.
    audit: async (receiving) => {
      const auditSupplierName = input.supplierName.trim() ||
        (await db.getOptional<{ name: string }>(
          `SELECT name FROM suppliers WHERE id = ? LIMIT 1`, [input.supplierId],
        ))?.name || 'مورد غير معروف'
      await audit.logReceivingCreated(
        receiving.id, auditSupplierName, receiving.totalCostUsd, input.lines.length,
        input.lines.map((line) => ({
          productId: line.productId, productName: line.productName,
          qtyReceived: Number(line.qtyReceived) || 0, unitCostUsd: Number(line.unitCostUsd) || 0,
          lineTotalUsd: (Number(line.qtyReceived) || 0) * (Number(line.unitCostUsd) || 0),
          costUpdated: line.updateCost,
        })),
      )
    },
    toEvent: (receiving) => ({
      type: InventoryEventType.StockReceived,
      entityId: receiving.id,
      payload: {
        receivingId: receiving.id, supplierId: input.supplierId,
        skuCount: input.lines.length, totalCost: receiving.totalCostUsd,
      } satisfies StockReceivedPayload,
      payloadVersion: 1,
      staffId: staffId ?? '',
      shopId,
      occurredAt: now,
    }),
  })
}

/** Narrow audit interface this service needs — implemented by the caller via
 *  useAuditLog(), never imported here. */
export interface InventoryAdjustAuditPort {
  logStockAdjusted: (productId: string, name: string, oldQty: number, newQty: number) => Promise<void>
}

export type AdjustInventoryInput =
  { productId: string; reason: AdjustmentReason; notes?: string } &
  ({ mode: 'absolute'; newValue: number } | { mode: 'delta'; delta: number })

export async function adjustInventory(
  shopId: string,
  deviceId: string,
  staffId: string,
  input: AdjustInventoryInput,
  audit: InventoryAdjustAuditPort,
): Promise<StockAdjustment | null> {
  if (input.mode === 'delta' && input.delta === 0) return null

  const now = new Date().toISOString()
  let oldValue = 0
  let clampedValue = 0
  const adjustmentId = uuidv4()

  const write = async (): Promise<StockAdjustment> => {
    await db.writeTransaction(async (tx) => {
      const stockResult = await tx.execute(
        'SELECT current_stock FROM products WHERE id = ?', [input.productId],
      )
      oldValue = (stockResult as any).rows._array[0]?.current_stock ?? 0
      // Stock can never go below zero — same never-below-zero clamp for both modes.
      clampedValue = input.mode === 'absolute'
        ? Math.max(0, input.newValue)
        : Math.max(0, oldValue + input.delta)

      await tx.execute(
        `UPDATE products SET current_stock = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
        [clampedValue, now, input.productId],
      )
      await checkLowStockCrossing(tx, shopId, input.productId, oldValue, clampedValue, now)
      await tx.execute(
        `INSERT INTO stock_adjustments (id, shop_id, product_id, old_value, new_value, reason, notes, created_at, device_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [adjustmentId, shopId, input.productId, oldValue, clampedValue, input.reason, input.notes ?? null, now, deviceId],
      )
    })
    return {
      id: adjustmentId, productId: input.productId, oldValue, newValue: clampedValue,
      reason: input.reason, notes: input.notes, createdAt: now, deviceId,
    }
  }

  return executeBusinessOperation(write, {
    // WAFI-150 final review (C3): NOT retired. InventoryAdjustedPayload's `deltaQty`
    // cannot reconstruct the old/new quantities (or the product name) this manual
    // call's audit_log meta -- and eventLabel's 'stock.adjusted' rendering -- both
    // require, without a state-reconstructing DB read, which the subscriber must not
    // do. This call stays manual (documented escape hatch per the design spec) and
    // auditSubscriber.ts's mapEventToAuditEntry maps 'inventory.adjusted' to null so
    // the subscriber does not double-log.
    audit: async (adjustment) => {
      const nameRow = await db.getOptional<{ name_ar: string }>(
        `SELECT name_ar FROM products WHERE id = ?`, [input.productId],
      )
      await audit.logStockAdjusted(input.productId, nameRow?.name_ar ?? input.productId, adjustment.oldValue, adjustment.newValue)
    },
    toEvent: (adjustment) => ({
      type: InventoryEventType.Adjusted,
      entityId: input.productId,
      payload: {
        productId: input.productId, deltaQty: adjustment.newValue - adjustment.oldValue,
        reason: input.reason,
      } satisfies InventoryAdjustedPayload,
      payloadVersion: 1,
      staffId,
      shopId,
      occurredAt: now,
    }),
  })
}
