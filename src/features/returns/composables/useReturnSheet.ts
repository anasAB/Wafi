import { ref, computed } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { v4 as uuidv4 } from 'uuid'
import type { ReturnLine, RefundMethod } from '../returns.types'

export function useReturnSheet(saleId: string) {
  const lines        = ref<ReturnLine[]>([])
  const refundMethod = ref<RefundMethod | null>(null)
  const reason       = ref('')
  const notes        = ref('')
  const hasCustomer  = ref(false)
  const customerId   = ref<string | null>(null)

  const refundTotalUsd = computed(() =>
    lines.value
      .filter(l => l.selected)
      .reduce((sum, l) => sum + l.qtyToReturn * l.unitPriceUsd, 0),
  )

  const canConfirm = computed(() =>
    lines.value.some(l => l.selected) && refundMethod.value !== null,
  )

  async function load(): Promise<void> {
    // 1. Fetch sale header
    const saleResult = await db.execute(
      `SELECT id, display_sale_number, customer_id FROM sales WHERE id = ?`,
      [saleId],
    )
    const sale = (saleResult as any).rows._array[0]
    if (!sale) throw new Error('Sale not found')
    customerId.value  = sale.customer_id ?? null
    hasCustomer.value = !!sale.customer_id

    // 2. Fetch original line items
    type LineRow = { product_id: string; product_name: string; quantity: number; unit_price_usd: number }
    const lineRows = await db.getAll<LineRow>(
      `SELECT sli.product_id, p.name_ar AS product_name, sli.quantity, sli.unit_price_usd
       FROM sale_line_items sli
       JOIN products p ON p.id = sli.product_id
       WHERE sli.sale_id = ?`,
      [saleId],
    )

    // 3. Fetch already-returned qty per product for this sale
    type ReturnedRow = { product_id: string; already_returned: number }
    const returnedRows = await db.getAll<ReturnedRow>(
      `SELECT rli.product_id, SUM(rli.qty_returned) AS already_returned
       FROM return_line_items rli
       JOIN returns r ON r.id = rli.return_id
       WHERE r.original_sale_id = ?
       GROUP BY rli.product_id`,
      [saleId],
    )
    const returnedMap = new Map(returnedRows.map(r => [r.product_id, r.already_returned]))

    lines.value = lineRows.map(row => ({
      productId:          row.product_id,
      productName:        row.product_name,
      originalQty:        row.quantity,
      alreadyReturnedQty: returnedMap.get(row.product_id) ?? 0,
      unitPriceUsd:       row.unit_price_usd,
      selected:           false,
      qtyToReturn:        1,
      restock:            true,
    }))
  }

  async function confirm(): Promise<void> {
    if (!refundMethod.value || !lines.value.some(l => l.selected)) {
      throw new Error('confirm() called without valid state')
    }

    const { shopId, deviceId } = useDeviceStore()

    // Get current exchange rate
    const rateResult = await db.execute(
      `SELECT rate FROM exchange_rates WHERE shop_id = ? ORDER BY set_at DESC LIMIT 1`,
      [shopId],
    )
    const exchangeRate: number = (rateResult as any).rows._array[0]?.rate ?? 1

    const selectedLines = lines.value.filter(l => l.selected)
    const refundAmountUsd = selectedLines.reduce((sum, l) => sum + l.qtyToReturn * l.unitPriceUsd, 0)
    const refundAmountSyp = refundAmountUsd * exchangeRate

    // Insert returns row
    const returnId  = uuidv4()
    const now       = new Date().toISOString()
    await db.execute(
      `INSERT INTO returns (id, shop_id, original_sale_id, created_at, refund_method, refund_amount_usd, refund_amount_syp, exchange_rate_at_return, reason, notes, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [returnId, shopId, saleId, now, refundMethod.value!, refundAmountUsd, refundAmountSyp, exchangeRate, reason.value || null, notes.value || null],
    )

    // Insert return_line_items
    for (const line of selectedLines) {
      await db.execute(
        `INSERT INTO return_line_items (id, return_id, shop_id, product_id, qty_returned, unit_price_usd, unit_price_syp, restock)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [uuidv4(), returnId, shopId, line.productId, line.qtyToReturn, line.unitPriceUsd, line.unitPriceUsd * exchangeRate, line.restock ? 1 : 0],
      )
    }

    // Restock + stock_adjustments
    for (const line of selectedLines.filter(l => l.restock)) {
      const stockResult = await db.execute(
        `SELECT current_stock FROM products WHERE id = ?`,
        [line.productId],
      )
      const oldStock: number = (stockResult as any).rows._array[0]?.current_stock ?? 0
      const newStock          = oldStock + line.qtyToReturn
      await db.execute(
        `UPDATE products SET current_stock = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
        [newStock, now, line.productId],
      )
      await db.execute(
        `INSERT INTO stock_adjustments (id, shop_id, product_id, old_value, new_value, reason, created_at, device_id)
         VALUES (?, ?, ?, ?, ?, 'return', ?, ?)`,
        [uuidv4(), shopId, line.productId, oldStock, newStock, now, deviceId],
      )
    }

    // Store credit
    if (refundMethod.value === 'store_credit' && customerId.value) {
      await db.execute(
        `INSERT INTO customer_payments (id, shop_id, customer_id, sale_id, amount_usd, currency, amount_raw, exchange_rate_at_payment, notes, paid_at, created_at, sync_status)
         VALUES (?, ?, ?, ?, ?, 'USD', ?, ?, 'مرتجع', ?, ?, 'pending')`,
        [uuidv4(), shopId, customerId.value, saleId, -refundAmountUsd, -refundAmountUsd, exchangeRate, now.slice(0, 10), now],
      )
    }
  }

  return { lines, refundMethod, reason, notes, hasCustomer, refundTotalUsd, canConfirm, load, confirm }
}
