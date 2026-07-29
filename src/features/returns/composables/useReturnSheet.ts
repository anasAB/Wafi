import { ref, computed } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { useShiftStore } from '@/features/shifts/shift.store'
import { v4 as uuidv4 } from 'uuid'
import type { ReturnLine, RefundMethod, ConfirmResult } from '../returns.types'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'
import { executeFinancialWrite } from '@/composables/executeFinancialWrite'
import { cancelPlanWithinTx } from '@/features/installments/composables/useInstallmentPlan'

export function useReturnSheet(saleId: string) {
  const { logReturnProcessed, logInstallmentPlanCancelled } = useAuditLog()

  const lines        = ref<ReturnLine[]>([])
  const refundMethod = ref<RefundMethod | null>(null)
  const reason       = ref('')
  const notes        = ref('')
  const hasCustomer  = ref(false)
  const customerId   = ref<string | null>(null)
  const customerName = ref<string | null>(null)   // original sale's customer (#8)
  const exchangeRate = ref(1)                       // rate at load, for SYP display (#7)

  // WAFI-011: a whole-sale (footer-level) discount is never baked into
  // sale_line_items.unit_price_usd (only per-line discounts are) — so refunding
  // qtyToReturn * unitPriceUsd alone over-refunds the customer relative to what
  // they actually paid whenever a sale-level discount was applied at checkout.
  function netUnitRefund(l: ReturnLine): number {
    return Math.max(0, l.unitPriceUsd - l.saleDiscountShareUsd)
  }

  const refundTotalUsd = computed(() =>
    lines.value
      .filter(l => l.selected)
      .reduce((sum, l) => sum + l.qtyToReturn * netUnitRefund(l), 0),
  )

  // Refund total in SYP, so the footer can show the amount in the selected currency.
  const refundTotalSyp = computed(() => Math.round(refundTotalUsd.value * exchangeRate.value))

  // WAFI-011: the portion of the refund total that's the prorated whole-sale
  // discount, so the sheet can show an explicit breakdown line instead of a
  // total that silently differs from qty * unit price with no explanation.
  const saleDiscountAppliedUsd = computed(() =>
    lines.value
      .filter(l => l.selected)
      .reduce((sum, l) => sum + l.qtyToReturn * l.saleDiscountShareUsd, 0),
  )

  const canConfirm = computed(() =>
    lines.value.some(l => l.selected) && refundMethod.value !== null,
  )

  async function load(): Promise<void> {
    const { shopId } = useDeviceStore()

    // 1. Fetch sale header + the customer it was sold to (#8)
    const saleResult = await db.execute(
      `SELECT s.id, s.display_sale_number, s.customer_id, c.name AS customer_name, s.sale_discount_amount_usd
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.id = ?`,
      [saleId],
    )
    const sale = (saleResult as any).rows._array[0]
    if (!sale) throw new Error('Sale not found')
    customerId.value   = sale.customer_id ?? null
    customerName.value = sale.customer_name ?? null
    hasCustomer.value  = !!sale.customer_id
    const saleDiscountAmountUsd: number = sale.sale_discount_amount_usd ?? 0

    // Current exchange rate, so the refund total can be shown in SYP (#7)
    const rateResult = await db.execute(
      `SELECT rate FROM exchange_rates WHERE shop_id = ? ORDER BY set_at DESC LIMIT 1`,
      [shopId],
    )
    exchangeRate.value = (rateResult as any).rows._array[0]?.rate ?? 1

    // 2. Fetch original line items
    type LineRow = { product_id: string; product_name: string; quantity: number; unit_price_usd: number; created_via: string | null }
    const lineRows = await db.getAll<LineRow>(
      `SELECT sli.product_id, p.name_ar AS product_name, sli.quantity, sli.unit_price_usd, p.created_via
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

    // WAFI-011: prorate the whole-sale discount across the ORIGINAL cart (every
    // line, before dropping already-fully-returned ones) by each line's share of
    // the original cart total — a line that's already been fully returned still
    // needs to count toward the denominator, or the remaining lines would absorb
    // a larger share of the discount than they actually carried at checkout.
    const originalCartTotalUsd = lineRows.reduce((sum, row) => sum + row.quantity * row.unit_price_usd, 0)

    lines.value = lineRows
      // Drop lines that have already been fully returned — they have nothing
      // left to refund, and showing them lets the owner refund the same unit twice.
      .filter(row => row.quantity - (returnedMap.get(row.product_id) ?? 0) > 0)
      .map(row => {
        const alreadyReturnedQty = returnedMap.get(row.product_id) ?? 0
        const remaining          = row.quantity - alreadyReturnedQty
        const isOpenItem = row.created_via === 'open_item'
        const lineOriginalTotalUsd = row.quantity * row.unit_price_usd
        const saleDiscountShareUsd = originalCartTotalUsd > 0
          ? (saleDiscountAmountUsd * (lineOriginalTotalUsd / originalCartTotalUsd)) / row.quantity
          : 0
        return {
          productId:          row.product_id,
          productName:        row.product_name,
          originalQty:        row.quantity,
          alreadyReturnedQty,
          unitPriceUsd:       row.unit_price_usd,
          saleDiscountShareUsd,
          selected:           false,
          qtyToReturn:        Math.min(1, remaining),
          restock:            !isOpenItem,
          isOpenItem,
        }
      })
  }

  async function confirm(): Promise<ConfirmResult> {
    if (!refundMethod.value || !lines.value.some(l => l.selected)) {
      throw new Error('confirm() called without valid state')
    }

    const { shopId, deviceId } = useDeviceStore()
    const shiftStore = useShiftStore()

    // Get current exchange rate (outside transaction — read-only lookup)
    const rateResult = await db.execute(
      `SELECT rate FROM exchange_rates WHERE shop_id = ? ORDER BY set_at DESC LIMIT 1`,
      [shopId],
    )
    const exchangeRate: number = (rateResult as any).rows._array[0]?.rate ?? 1

    const selectedLines = lines.value.filter(l => l.selected)

    // Data-layer guard: never refund/restock more than what is still returnable.
    // The UI clamps too, but the write path must not depend on the UI being correct.
    for (const line of selectedLines) {
      const remaining = line.originalQty - line.alreadyReturnedQty
      if (line.qtyToReturn < 1 || line.qtyToReturn > remaining) {
        throw new Error(
          `Cannot return more than remaining for ${line.productName}: ` +
          `requested ${line.qtyToReturn}, remaining ${remaining}`,
        )
      }
    }

    const refundAmountUsd = selectedLines.reduce((sum, l) => sum + l.qtyToReturn * netUnitRefund(l), 0)
    const refundAmountSyp = Math.round(refundAmountUsd * exchangeRate)

    const returnId  = uuidv4()
    const now       = new Date().toISOString()

    const { cancelledPlanId, warning } = await executeFinancialWrite(
      async () => {
        let cancelledPlanId: string | null = null
        let warning: ConfirmResult['warning']

        await db.writeTransaction(async (tx) => {
          // Insert returns row (shift_id links cash refunds to the open shift for the Z-report)
          await tx.execute(
            `INSERT INTO returns (id, shop_id, original_sale_id, created_at, refund_method, refund_amount_usd, refund_amount_syp, exchange_rate_at_return, reason, notes, shift_id, sync_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
            [returnId, shopId, saleId, now, refundMethod.value!, refundAmountUsd, refundAmountSyp, exchangeRate, reason.value || null, notes.value || null, shiftStore.activeShiftId ?? null],
          )

          // Insert return_line_items
          for (const line of selectedLines) {
            await tx.execute(
              `INSERT INTO return_line_items (id, return_id, shop_id, product_id, qty_returned, unit_price_usd, unit_price_syp, restock, sync_status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
              [uuidv4(), returnId, shopId, line.productId, line.qtyToReturn, line.unitPriceUsd, Math.round(line.unitPriceUsd * exchangeRate), line.restock ? 1 : 0],
            )
          }

          // Restock + stock_adjustments. Open-item lines never restock — they have no
          // real catalog stock to add back to (WAFI-101).
          for (const line of selectedLines.filter(l => l.restock && !l.isOpenItem)) {
            const stockResult = await tx.execute(
              `SELECT current_stock FROM products WHERE id = ?`,
              [line.productId],
            )
            const oldStock: number = (stockResult as any).rows._array[0]?.current_stock ?? 0
            const newStock          = oldStock + line.qtyToReturn
            await tx.execute(
              `UPDATE products SET current_stock = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
              [newStock, now, line.productId],
            )
            await tx.execute(
              `INSERT INTO stock_adjustments (id, shop_id, product_id, old_value, new_value, reason, created_at, device_id)
               VALUES (?, ?, ?, ?, ?, 'return', ?, ?)`,
              [uuidv4(), shopId, line.productId, oldStock, newStock, now, deviceId],
            )
          }

          // Note: a returned credit sale reduces the customer's outstanding balance
          // through the `returns` table itself (see useCustomerBalance / the dashboard
          // credit count), so no customer_payments row is written here. Doing so would
          // double-count the return — and a negative payment would wrongly INCREASE the
          // balance under the `sales - payments` formula.

          // WAFI-010: recompute whether this return, taken together with every return
          // already committed for this sale (INCLUDING the one just inserted above),
          // exhausts every original line item. Deliberately re-read from the database
          // here rather than trusting `lines.value` (populated at sheet-load time) —
          // a second, concurrent return sheet on the same sale would otherwise miss
          // that the combined effect of both returns is a full-sale return.
          const originalRows = await tx.execute(
            `SELECT product_id, quantity FROM sale_line_items WHERE sale_id = ?`,
            [saleId],
          )
          const returnedRows = await tx.execute(
            `SELECT rli.product_id, SUM(rli.qty_returned) AS returned_qty
             FROM return_line_items rli
             JOIN returns r ON r.id = rli.return_id
             WHERE r.original_sale_id = ?
             GROUP BY rli.product_id`,
            [saleId],
          )
          const returnedMap = new Map<string, number>(
            ((returnedRows as any).rows?._array ?? []).map((r: any) => [r.product_id, r.returned_qty]),
          )
          const originalRowsArray = (originalRows as any).rows?._array ?? []
          const isFullSaleReturn = originalRowsArray.length > 0 && originalRowsArray.every(
            (row: any) => (returnedMap.get(row.product_id) ?? 0) >= row.quantity,
          )

          // WAFI-010: plan lookup, deliberately unfiltered by status — see
          // useReturnSheet's design spec §2 for why filtering in SQL would risk
          // silently absorbing a future plan status into the wrong branch.
          const planRows = await tx.execute(
            `SELECT id, status FROM installment_plans WHERE sale_id = ?`,
            [saleId],
          )
          const plan = (planRows as any).rows?._array?.[0] as { id: string; status: string } | undefined

          if (plan) {
            if (plan.status === 'active' && isFullSaleReturn) {
              const cancelled = await cancelPlanWithinTx(tx, plan.id)
              if (cancelled) cancelledPlanId = plan.id
            } else if (plan.status !== 'completed' && plan.status !== 'cancelled') {
              // Covers 'active'+partial, 'defaulted' (any completeness), and any
              // unrecognized future status — normative per the design spec's
              // decision table: only completed/cancelled ever suppress the warning.
              warning = { type: 'plan_requires_manual_review', planStatus: plan.status }
            }
          }
        })

        return { cancelledPlanId, warning }
      },
      ({ cancelledPlanId }) => Promise.all([
        logReturnProcessed(returnId, saleId, refundAmountUsd),
        cancelledPlanId
          ? logInstallmentPlanCancelled(cancelledPlanId, { reason: 'sale_returned', returnId })
          : Promise.resolve(),
      ]),
    )

    return { warning }
  }

  return { lines, refundMethod, reason, notes, hasCustomer, customerName, refundTotalUsd, refundTotalSyp, saleDiscountAppliedUsd, canConfirm, load, confirm }
}
