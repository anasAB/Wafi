import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { executeBusinessOperation } from '@/composables/executeBusinessOperation'
import { SalesEventType } from '@/services/events/domainEvent.types'
import { publishEvent } from '@/services/events/publishEvent'
import type { PaymentMethod, SplitPaymentEntry, CompletedSale } from '@/features/payment/payment.types'
import type { SaleLine, SaleDiscount } from '@/store/sale.store'
import type { DiscountType } from '@/features/pos/discounts'
import type { SaleCompletedPayload, SaleDiscountedPayload } from '@/services/events/domainEvent.types'

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// Duplicated (not imported) from useSaleNumber.ts's pure formatNumber — this
// service must stay free of any composable import.
function formatNumber(deviceCode: string, sequence: number): string {
  const padded = String(sequence + 1).padStart(6, '0')
  return `${deviceCode}-${padded}`
}

// Duplicated (not imported) from usePayment.ts's buildEntry — needed by both
// the live split-payment UI (usePayment.ts's addPayment, unchanged) and this
// service's single-tender path. Pure, no Vue/store dependency either place.
function buildEntry(
  m: 'cash_usd' | 'cash_syp' | 'card',
  amountRaw: number,
  remaining: number,
  rate: number,
): SplitPaymentEntry {
  const currency: 'USD' | 'SYP' = m === 'cash_syp' ? 'SYP' : 'USD'
  const grossUsd   = m === 'cash_syp' ? amountRaw / rate : amountRaw
  const appliedUsd = Math.min(grossUsd, remaining)
  const overUsd    = grossUsd - appliedUsd

  // Card is charged for the exact applied amount — never any change.
  if (m === 'card' || overUsd <= 0.001) {
    return { method: m, amountRaw, currency, amountUsd: appliedUsd, exchangeRate: rate, changeDue: 0 }
  }

  const changeNative = currency === 'SYP' ? Math.round(overUsd * rate) : round2(overUsd)
  const netRaw       = currency === 'SYP' ? Math.round(appliedUsd * rate) : round2(appliedUsd)
  return { method: m, amountRaw: netRaw, currency, amountUsd: appliedUsd, exchangeRate: rate, changeDue: changeNative }
}

export interface CompleteSaleInput {
  shopId: string
  deviceId: string
  deviceCode: string
  staffId: string | null
  shiftId: string | null
  /** Cart sequence BEFORE increment (saleStore.deviceSequence) — this service
   *  computes saleSeq/displaySaleNumber from it but never persists the advance
   *  itself (WAFI-004: the caller increments only after this resolves). */
  deviceSequence: number
  method: PaymentMethod | null
  amountReceived: number | null
  pendingPayments: SplitPaymentEntry[]
  customerId?: string
  totalUsd: number
  totalSyp: number
  exchangeRateAtSale: number
  lines: SaleLine[]
  saleDiscount: SaleDiscount | null
}

/** Narrow audit interface this service needs — implemented by the caller via
 *  useAuditLog(), never imported here. */
export interface CompleteSaleAuditPort {
  logDiscountApplied: (
    saleId: string,
    meta: {
      operatorId: string | null; tierApplied: 'retail'; basePriceUsd: number
      discountType: DiscountType; discountValue: number; finalPriceUsd: number
      pinApproval: boolean; belowCost: boolean
    },
  ) => Promise<void>
}

export async function completeSale(
  input: CompleteSaleInput,
  audit: CompleteSaleAuditPort,
): Promise<CompletedSale> {
  const saleId     = uuidv4()
  const now        = new Date().toISOString()
  const saleSeq    = input.deviceSequence + 1
  const displayNum = formatNumber(input.deviceCode, input.deviceSequence)

  // A credit (آجل) or installment sale is unpaid at sale time — it must NOT
  // record any tendered payment. (Installment's down payment posts separately
  // through customer_payments — see useInstallmentPlan.createPlan, called by
  // the caller after this sale commits.)
  const isCredit = (input.method === 'credit' || input.method === 'installment') && input.pendingPayments.length === 0

  let entries: SplitPaymentEntry[]
  if (isCredit) {
    entries = []
  } else if (input.pendingPayments.length > 0) {
    entries = input.pendingPayments
  } else {
    const rate   = input.exchangeRateAtSale
    const m      = input.method as 'cash_usd' | 'cash_syp' | 'card'
    const rawAmt = input.amountReceived ?? input.totalUsd
    entries = [buildEntry(m, rawAmt, input.totalUsd, rate)]
  }

  const isSplit       = entries.length > 1
  const primaryMethod: PaymentMethod =
    input.method === 'installment' ? 'installment'
    : isCredit ? 'credit'
    : isSplit  ? 'split'
    : entries[0].method
  const totalReceived = entries.reduce((s, e) => s + e.amountUsd, 0)
  const lastChange    = entries.length > 0 ? entries[entries.length - 1].changeDue : 0

  const sale: CompletedSale = {
    saleId,
    displaySaleNumber:      displayNum,
    totalUsd:               input.totalUsd,
    totalSyp:               input.totalSyp,
    exchangeRateAtSale:     input.exchangeRateAtSale,
    paymentMethod:          primaryMethod,
    amountReceived:         totalReceived,
    amountReceivedCurrency: 'USD',
    changeDue:              lastChange || undefined,
    createdAt:              now,
    customerId:             input.customerId,
    splitPayments:          isSplit ? entries : undefined,
    lines:                  input.lines.map(l => ({
      nameAr:              l.nameAr,
      quantity:            l.quantity,
      unitPriceUsd:        l.unitPriceUsd,
      lineTotalUsd:        l.lineTotalUsd,
      discountType:        l.discountType,
      discountValue:       l.discountValue,
      discountPinApproved: l.discountPinApproved,
      unitCostUsd:         l.unitCostUsd,
      listPriceUsd:        l.listPriceUsd,
    })),
    saleDiscount:           input.saleDiscount,
  }

  const write = async (): Promise<CompletedSale> => {
    // All writes for one sale run in a single transaction so a mid-way failure
    // can't leave a sale row without its line items, payments, or stock movements.
    await db.writeTransaction(async (tx) => {
      await tx.execute(
        `INSERT INTO sales (id, shop_id, device_id, device_sequence, display_sale_number,
          created_at, total_usd, total_syp, exchange_rate_at_sale, payment_method,
          amount_received, amount_received_currency, change_due, customer_id, is_credit, is_split,
          shift_id, staff_id, sale_discount_type, sale_discount_value, sale_discount_amount_usd, sync_status, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          saleId, input.shopId, input.deviceId,
          saleSeq, displayNum, now,
          input.totalUsd, input.totalSyp, input.exchangeRateAtSale,
          primaryMethod, totalReceived, 'USD', lastChange || null,
          input.customerId ?? null, isCredit ? 1 : 0, isSplit ? 1 : 0,
          input.shiftId,
          // Attribution rule: the operator active at confirmation owns the sale
          // (the cart can change hands via switch-operator). shift_id stays the
          // cash-period link.
          input.staffId,
          input.saleDiscount?.type ?? null,
          input.saleDiscount?.value ?? null,
          input.saleDiscount?.amountUsd ?? 0,
          'pending',
          // WAFI-008: every sale rung through this path is a live POS sale.
          // Set explicitly, not left to the column default, matching this
          // insert's existing convention of listing every business-meaningful
          // column rather than depending on a schema default.
          'pos',
        ],
      )

      // Insert one row per payment entry into sale_payments
      for (const entry of entries) {
        await tx.execute(
          `INSERT INTO sale_payments (id, sale_id, shop_id, method, amount_raw, currency,
            amount_usd, exchange_rate, change_due, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            uuidv4(), saleId, input.shopId, entry.method, entry.amountRaw,
            entry.currency, entry.amountUsd, entry.exchangeRate,
            entry.changeDue || null, now,
          ],
        )
      }

      for (const line of input.lines) {
        // WAFI-101 — open items are a hidden synthetic product with no real
        // stock: never touch current_stock or write a stock_adjustments row.
        if (line.isOpenItem) {
          await tx.execute(
            `INSERT INTO sale_line_items
              (id, sale_id, shop_id, product_id, quantity, unit_price_usd, unit_cost_usd, line_total_usd,
               discount_type, discount_value, discount_amount_usd)
             VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
            [uuidv4(), saleId, input.shopId, line.productId,
             line.quantity, line.unitPriceUsd, line.lineTotalUsd,
             line.discountType ?? null, line.discountValue ?? null, line.discountAmountUsd ?? 0],
          )
          continue
        }

        const res = await tx.execute(
          'SELECT cost_price_usd, current_stock FROM products WHERE id = ?',
          [line.productId],
        )
        const row          = (res as any).rows?._array?.[0]
        const unitCostUsd  = row?.cost_price_usd ?? 0
        const currentStock = row?.current_stock ?? 0
        // Clamp at 0: a sale must never drive on-hand stock negative (e.g. when
        // the cart was built against stale stock, or an offline oversell).
        const newStock     = Math.max(0, currentStock - line.quantity)
        // When clamping drops fewer units than were sold, the count was stale.
        // Mark the oversold quantity on the adjustment so reconciliation can see
        // the gap between the line quantity and the recorded stock movement.
        const oversoldBy   = line.quantity - (currentStock - newStock)
        const adjustNote   = oversoldBy > 0 ? `oversold:${oversoldBy}` : null

        await tx.execute(
          `INSERT INTO sale_line_items
            (id, sale_id, shop_id, product_id, quantity, unit_price_usd, unit_cost_usd, line_total_usd,
             discount_type, discount_value, discount_amount_usd)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [uuidv4(), saleId, input.shopId, line.productId,
           line.quantity, line.unitPriceUsd, unitCostUsd, line.lineTotalUsd,
           line.discountType ?? null, line.discountValue ?? null, line.discountAmountUsd ?? 0],
        )
        await tx.execute(
          `UPDATE products SET current_stock = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
          [newStock, now, line.productId],
        )
        await tx.execute(
          `INSERT INTO stock_adjustments (id, shop_id, product_id, old_value, new_value, reason, notes, created_at, device_id)
           VALUES (?, ?, ?, ?, ?, 'sale', ?, ?, ?)`,
          [uuidv4(), input.shopId, line.productId, currentStock, newStock, adjustNote, now, input.deviceId],
        )
      }
    })

    return sale
  }

  return executeBusinessOperation(write, {
    // WAFI-150: sale completion is now audited automatically by the audit
    // subscriber off sale.completed (see toEvent below) — only per-line/
    // sale-level discount audit entries still need a manual call.
    audit: async (completed) => {
      // WAFI-100: one audit entry per discounted line, plus one for a
      // sale-level discount if present. Reads from the captured `sale`
      // snapshot (built above from `input`, not any live store) so nothing
      // here can go stale even though the caller may clear its cart state
      // right after this resolves.
      for (const line of completed.lines) {
        if (!line.discountType) continue
        const base = line.listPriceUsd ?? line.unitPriceUsd
        const belowCost = line.unitPriceUsd < (line.unitCostUsd ?? 0)
        const pinApproval = Boolean(line.discountPinApproved)
        await audit.logDiscountApplied(completed.saleId, {
          operatorId:    input.staffId,
          tierApplied:   'retail',
          basePriceUsd:  base,
          discountType:  line.discountType,
          discountValue: line.discountValue ?? 0,
          finalPriceUsd: line.unitPriceUsd,
          pinApproval,
          belowCost,
        })
        // WAFI-143: executeBusinessOperation's toEvent slot is already taken by
        // sale.completed for this write, and a sale can have multiple discount
        // instances (this loop + the sale-level block below) -- publishEvent() is
        // called directly here, fire-and-forget, the same escape hatch
        // device.registered already uses (Sprint 2 design spec §5a).
        void publishEvent({
          type: SalesEventType.Discounted,
          entityId: completed.saleId,
          payload: {
            discountType: line.discountType,
            discountValue: line.discountValue ?? 0,
            discountPercentage: line.discountType === 'percent' ? (line.discountValue ?? 0) : undefined,
            finalPriceUsd: line.unitPriceUsd,
            belowCost,
            pinApproval,
          } satisfies SaleDiscountedPayload,
          payloadVersion: 1,
          staffId: input.staffId ?? '',
          shopId: input.shopId,
          occurredAt: now,
        }).catch(() => {})
      }
      if (completed.saleDiscount) {
        const sd = completed.saleDiscount
        const pinApproval = Boolean(sd.pinApproved)
        await audit.logDiscountApplied(completed.saleId, {
          operatorId:    input.staffId,
          tierApplied:   'retail',
          basePriceUsd:  completed.totalUsd + sd.amountUsd,
          discountType:  sd.type,
          discountValue: sd.value,
          finalPriceUsd: completed.totalUsd,
          pinApproval,
          belowCost:     false,
        })
        void publishEvent({
          type: SalesEventType.Discounted,
          entityId: completed.saleId,
          payload: {
            discountType: sd.type,
            discountValue: sd.value,
            discountPercentage: sd.type === 'percent' ? sd.value : undefined,
            finalPriceUsd: completed.totalUsd,
            belowCost: false,
            pinApproval,
          } satisfies SaleDiscountedPayload,
          payloadVersion: 1,
          staffId: input.staffId ?? '',
          shopId: input.shopId,
          occurredAt: now,
        }).catch(() => {})
      }
    },
    toEvent: (completed) => ({
      type: SalesEventType.Completed,
      entityId: completed.saleId,
      payload: {
        saleId: completed.saleId, shopId: input.shopId, staffId: input.staffId ?? '',
        totalUsd: completed.totalUsd, totalSyp: completed.totalSyp,
        paymentSummary: {
          cashUsd: entries.filter(e => e.method === 'cash_usd').reduce((s, e) => s + e.amountUsd, 0),
          cashSyp: entries.filter(e => e.method === 'cash_syp').reduce((s, e) => s + e.amountUsd, 0),
          cardTotal: entries.filter(e => e.method === 'card').reduce((s, e) => s + e.amountUsd, 0),
          creditTotal: isCredit ? completed.totalUsd : 0,
          methodCount: entries.length || 1,
        },
        itemCount: completed.lines.length,
        discountApplied: completed.lines.some(l => l.discountType) || !!completed.saleDiscount,
      } satisfies SaleCompletedPayload,
      payloadVersion: 1,
      staffId: input.staffId ?? '',
      shopId: input.shopId,
      occurredAt: now,
    }),
  })
}
