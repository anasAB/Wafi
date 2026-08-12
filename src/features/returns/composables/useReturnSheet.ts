import { ref, computed } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { useSessionStore } from '@/store/session.store'
import { useShiftStore } from '@/features/shifts/shift.store'
import { v4 as uuidv4 } from 'uuid'
import type { ReturnLine, RefundMethod, ConfirmResult } from '../returns.types'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'
import { executeBusinessOperation } from '@/composables/executeBusinessOperation'
import { cancelPlanWithinTx } from '@/features/installments/composables/useInstallmentPlan'
import {
  ReturnsEventType, CustomerEventType,
  type ReturnedPayload, type DebtChangedPayload,
} from '@/services/events/domainEvent.types'
import { fetchOutstandingBalanceUsd } from '@/features/customers/composables/useCustomerBalance'
import { publishEvent } from '@/services/events/publishEvent'
import { logger } from '@/services/events/logger'

export function useReturnSheet(saleId: string) {
  const { logInstallmentPlanCancelled } = useAuditLog()

  const lines        = ref<ReturnLine[]>([])
  const refundMethod = ref<RefundMethod | null>(null)
  const reason       = ref('')
  const notes        = ref('')
  const hasCustomer  = ref(false)
  const customerId   = ref<string | null>(null)
  const customerName = ref<string | null>(null)   // original sale's customer (#8)
  const exchangeRate = ref(1)                       // rate at load, for SYP display (#7)
  const isCreditSale = ref(false)

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
      `SELECT s.id, s.display_sale_number, s.customer_id, c.name AS customer_name, s.sale_discount_amount_usd, s.is_credit
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.id = ?`,
      [saleId],
    )
    const sale = (saleResult as any).rows._array[0]
    if (!sale) throw new Error('Sale not found')
    customerId.value   = sale.customer_id ?? null
    customerName.value = sale.customer_name ?? null
    hasCustomer.value  = !!sale.customer_id
    isCreditSale.value = !!sale.is_credit
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

    const refundAmountUsd = selectedLines.reduce((sum, l) => sum + l.qtyToReturn * netUnitRefund(l), 0)
    const refundAmountSyp = Math.round(refundAmountUsd * exchangeRate)

    const returnId  = uuidv4()
    const now       = new Date().toISOString()

    // WAFI-153: restock-aware, per-(sale,product)-averaged COGS reversal --
    // ports useDashboardMetrics.ts's existing read-time subquery (WAFI-005
    // dedup: a product on two lines of the same sale is averaged once, not
    // double-counted) to write time.
    const costRows = await db.getAll<{ product_id: string; unit_cost_usd: number }>(
      `SELECT product_id, AVG(unit_cost_usd) AS unit_cost_usd FROM sale_line_items WHERE sale_id = ? GROUP BY product_id`,
      [saleId],
    )
    const costMap = new Map(costRows.map(r => [r.product_id, r.unit_cost_usd ?? 0]))
    const cogsReversalUsd = selectedLines
      .filter(l => l.restock && !l.isOpenItem)
      .reduce((sum, l) => sum + l.qtyToReturn * (costMap.get(l.productId) ?? 0), 0)

    const costlessRow = await db.getOptional<{ c: number }>(
      `SELECT COUNT(*) AS c FROM sale_line_items WHERE sale_id = ? AND (unit_cost_usd IS NULL OR unit_cost_usd = 0)`,
      [saleId],
    )
    const saleWasCostless = (costlessRow?.c ?? 0) > 0

    // WAFI-153: the original sale.completed event's event_projection_day,
    // read once here (write time), never re-derived at apply time -- avoids
    // a nondeterministic lookup inside the apply function.
    const originalSaleEventRow = await db.getOptional<{ event_projection_day: string }>(
      `SELECT event_projection_day FROM events WHERE type = 'sale.completed' AND json_extract(payload, '$.saleId') = ? ORDER BY sequence ASC LIMIT 1`,
      [saleId],
    )
    const originalSaleProjectionDay = originalSaleEventRow?.event_projection_day

    const { warning, isFullSaleReturn } = await executeBusinessOperation(
      async () => {
        let cancelledPlanId: string | null = null
        let warning: ConfirmResult['warning']
        let isFullSaleReturn = false

        await db.writeTransaction(async (tx) => {
          // Data-layer guard: never refund/restock more than what is still returnable.
          // Pre-existing guard, hardened here: it used to compare against
          // `line.alreadyReturnedQty`, a count frozen at sheet-load time — if a
          // second return sheet on the same sale committed in between, this
          // check would pass on stale data and this transaction would insert
          // an over-return (over-refund + over-restock) for that product.
          // Read the true already-returned quantity fresh, inside this
          // transaction, right before validating.
          const preInsertReturnedRows = await tx.execute(
            `SELECT rli.product_id, SUM(rli.qty_returned) AS returned_qty
             FROM return_line_items rli
             JOIN returns r ON r.id = rli.return_id
             WHERE r.original_sale_id = ?
             GROUP BY rli.product_id`,
            [saleId],
          )
          const freshReturnedMap = new Map<string, number>(
            ((preInsertReturnedRows as any).rows?._array ?? []).map((r: any) => [r.product_id, r.returned_qty]),
          )
          for (const line of selectedLines) {
            const freshAlreadyReturned = freshReturnedMap.get(line.productId) ?? 0
            const remaining = line.originalQty - freshAlreadyReturned
            if (line.qtyToReturn < 1 || line.qtyToReturn > remaining) {
              throw new Error(
                `Cannot return more than remaining for ${line.productName}: ` +
                `requested ${line.qtyToReturn}, remaining ${remaining}`,
              )
            }
          }

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
          // exhausts every original line item. Deliberately computed from a fresh
          // database read rather than trusting `lines.value` (populated at
          // sheet-load time) — a second, concurrent return sheet on the same
          // sale would otherwise miss that the combined effect of both returns
          // is a full-sale return.
          //
          // Reuses `freshReturnedMap` (read above, pre-insert) instead of
          // re-querying return_line_items a second time: we are the ones who
          // just inserted exactly `line.qtyToReturn` more of each selected
          // product in this same transaction, so incrementing in-memory by
          // those same amounts is equivalent to re-reading, without the
          // second round-trip.
          for (const line of selectedLines) {
            freshReturnedMap.set(line.productId, (freshReturnedMap.get(line.productId) ?? 0) + line.qtyToReturn)
          }
          // Aggregate-vs-aggregate: GROUP BY product_id here even though
          // sale.store.ts's addLine() currently enforces at most one
          // sale_line_items row per product_id per sale — harden the
          // comparison so it doesn't rely on an invariant that lives in a
          // different file two layers away.
          const originalRows = await tx.execute(
            `SELECT product_id, SUM(quantity) AS quantity FROM sale_line_items WHERE sale_id = ? AND shop_id = ? GROUP BY product_id`,
            [saleId, shopId],
          )
          const originalRowsArray = (originalRows as any).rows?._array ?? []
          isFullSaleReturn = originalRowsArray.length > 0 && originalRowsArray.every(
            (row: any) => (freshReturnedMap.get(row.product_id) ?? 0) >= row.quantity,
          )

          // WAFI-010: plan lookup, deliberately unfiltered by status — see
          // useReturnSheet's design spec §2 for why filtering in SQL would risk
          // silently absorbing a future plan status into the wrong branch.
          // ORDER BY prioritizes a non-terminal plan (active, then defaulted)
          // and the most recent row — a sale can have more than one
          // installment_plans row (e.g. a cancelled one plus a re-issued
          // active one; no UNIQUE(sale_id) constraint exists), and picking an
          // arbitrary row would risk silently no-op'ing on a genuinely active
          // plan.
          const planRows = await tx.execute(
            `SELECT id, status FROM installment_plans WHERE sale_id = ? AND shop_id = ?
             ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'defaulted' THEN 1 ELSE 2 END, created_at DESC
             LIMIT 1`,
            [saleId, shopId],
          )
          const plan = (planRows as any).rows?._array?.[0] as { id: string; status: string } | undefined

          if (plan) {
            // WAFI-010 review #3: installment_plans/installment_dues UPDATEs are
            // restricted by server RLS to owner/manager (migration 059). A
            // cashier's auto-cancel would sync-reject and land in
            // sync_dead_letter while the returns insert + audit row DO sync —
            // a phantom cancellation with no server-side effect. Gate on role
            // instead of attempting a write RLS will reject.
            const activeRole = useSessionStore().activeStaff?.role
            const canMutatePlan = activeRole === 'owner' || activeRole === 'manager'

            if (plan.status === 'active' && isFullSaleReturn && canMutatePlan) {
              const cancelled = await cancelPlanWithinTx(tx, plan.id)
              if (cancelled) cancelledPlanId = plan.id
            } else if (plan.status !== 'completed' && plan.status !== 'cancelled') {
              // Covers 'active'+partial, 'defaulted' (any completeness), a
              // cashier attempting an otherwise-qualifying full-sale return
              // (still reads planStatus as 'active' — the warning's purpose is
              // "needs manual review", true here for a role reason), and any
              // unrecognized future status — normative per the design spec's
              // decision table: only completed/cancelled ever suppress the warning.
              warning = { type: 'plan_requires_manual_review', planStatus: plan.status }
            }
          }
        })

        return { cancelledPlanId, warning, isFullSaleReturn }
      },
      {
        // WAFI-150: the return itself is now audited automatically by the
        // audit subscriber off sale.returned (see toEvent below) — only the
        // installment-plan-cancellation side effect still needs a manual entry.
        audit: async ({ cancelledPlanId }) => {
          if (cancelledPlanId) {
            await logInstallmentPlanCancelled(cancelledPlanId, { reason: 'sale_returned', returnId })
          }
        },
        toEvent: ({ isFullSaleReturn }) => ({
          type: ReturnsEventType.Returned,
          entityId: returnId,
          payload: {
            returnId, saleId, refundAmountUsd,
            restockedItemCount: selectedLines.filter(l => l.restock && !l.isOpenItem).length,
            cogsReversalUsd,
            isFullReturn: isFullSaleReturn,
            saleWasCostless,
            originalSaleProjectionDay: originalSaleProjectionDay ?? now.slice(0, 10),
          } satisfies ReturnedPayload,
          payloadVersion: 2,
          staffId: useSessionStore().activeStaff?.id ?? '',
          shopId,
          occurredAt: now,
        }),
      },
    )

    // executeBusinessOperation's toEvent only supports one event per write
    // (Task 2's documented limitation) -- customer.debt_changed can't ride the
    // same hook as sale.returned, so it's published directly here. Fires
    // whenever the customer's balance actually changes: either the original
    // sale was a credit sale, OR (WAFI-140 final-review fix) the refund was
    // paid out as store credit on a CASH sale -- useCustomerBalance's
    // BALANCE_USD_SQL deliberately subtracts that case too (it makes the shop
    // owe the customer, i.e. negative balance / "customer credit"), so it must
    // also raise this event.
    //
    // The whole block (balance fetch + publish) is wrapped so nothing here can
    // ever throw out of confirm() -- the return/refund/restock above has
    // already committed by this point, and executeBusinessOperation's
    // invariant is that publish/event-side failures must never become write
    // failures. A throw here (e.g. the balance fetch failing) would otherwise
    // surface as a confirm() rejection on an already-committed return, risking
    // a duplicate refund if the cashier re-taps confirm.
    if (customerId.value && (isCreditSale.value || refundMethod.value === 'store_credit')) {
      try {
        const newBalanceUsd = await fetchOutstandingBalanceUsd(customerId.value, shopId)
        await publishEvent<DebtChangedPayload>({
          type: CustomerEventType.DebtChanged,
          entityId: customerId.value,
          payload: {
            customerId: customerId.value,
            deltaUsd: -refundAmountUsd,
            newBalanceUsd,
            reason: 'return',
          },
          payloadVersion: 1,
          staffId: useSessionStore().activeStaff?.id ?? '',
          shopId,
          occurredAt: now,
        })
      } catch (err) {
        logger.error('[useReturnSheet] failed to publish customer.debt_changed after a committed return', err)
      }
    }

    return { warning }
  }

  return { lines, refundMethod, reason, notes, hasCustomer, customerName, refundTotalUsd, refundTotalSyp, saleDiscountAppliedUsd, canConfirm, load, confirm }
}
