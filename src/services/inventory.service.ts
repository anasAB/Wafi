import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { executeBusinessOperation } from '@/composables/executeBusinessOperation'
import { InventoryEventType } from '@/services/events/domainEvent.types'
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
  _audit: ReceiveStockAuditPort,
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
    // WAFI-150: a stock receiving is now audited automatically by the audit
    // subscriber off stock.received (see toEvent below) — `audit` (still
    // required by executeBusinessOperation's hook contract, and still
    // accepted as a parameter so callers/tests are unaffected) is now a
    // deliberate no-op.
    audit: async () => {},
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
  _audit: InventoryAdjustAuditPort,
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
    // WAFI-150: a stock adjustment is now audited automatically by the audit
    // subscriber off inventory.adjusted (see toEvent below) — `audit` is now
    // a deliberate no-op (kept as a required hook and as a parameter so
    // callers/tests are unaffected).
    audit: async () => {},
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
