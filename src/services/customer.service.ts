import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { executeBusinessOperation } from '@/composables/executeBusinessOperation'
import { CustomerEventType } from '@/services/events/domainEvent.types'
import { fetchOutstandingBalanceUsd } from '@/features/customers/composables/useCustomerBalance'
import type { PaymentAllocation } from '@/features/customers/customer.types'

export interface CustomerBalance {
  balanceUsd: number
  pendingSyncCount: number
}

/** Narrow audit interface this service needs — implemented by the caller via
 *  useAuditLog(), never imported here. */
export interface RecordPaymentAuditPort {
  logCustomerPaymentRecorded: (customerId: string, amountUsd: number) => Promise<void>
}

export async function recordPayment(
  shopId: string,
  customerId: string,
  allocations: PaymentAllocation[],
  audit: RecordPaymentAuditPort,
  shiftId: string | null = null,
  deviceId: string | null = null,
): Promise<CustomerBalance> {
  const now = new Date().toISOString()

  // Guard: do not allow allocations to exceed the remaining on an invoice. Track the
  // cumulative amount allocated per sale within THIS batch, so two allocations to the
  // same invoice can't each pass the guard individually and together overpay.
  const committedBySale = new Map<string, number>()
  let batchTotalUsd = 0
  let perSaleUnavailable = false  // a sale row wasn't visible locally (offline)
  for (const alloc of allocations) {
    batchTotalUsd += alloc.amountUsd
    const remRow = await db.getOptional<{ remaining_usd: number }>(
      `SELECT s.total_usd
         - COALESCE(SUM(cp.amount_usd), 0)
         - COALESCE((SELECT SUM(r.refund_amount_usd) FROM returns r WHERE r.original_sale_id = s.id), 0)
         AS remaining_usd
       FROM sales s
       LEFT JOIN customer_payments cp ON cp.sale_id = s.id
       WHERE s.id = ?
       GROUP BY s.id`,
      [alloc.saleId],
    )
    // The sale row isn't visible locally (offline / newly synced): its per-sale
    // remaining can't be verified, so defer to the customer-balance guard below.
    if (remRow === null) { perSaleUnavailable = true; continue }
    if (remRow.remaining_usd === undefined) continue
    const already = committedBySale.get(alloc.saleId) ?? 0
    if (already + alloc.amountUsd > remRow.remaining_usd + 0.001) {
      throw new Error(`المبلغ المدخل يتجاوز المبلغ المتبقي للفاتورة`)
    }
    committedBySale.set(alloc.saleId, already + alloc.amountUsd)
  }

  // Offline-safe bound: when any per-sale remaining couldn't be verified, the
  // batch still must not exceed the customer's total outstanding balance — so a
  // payment can never overpay just because the invoice rows haven't synced yet.
  if (perSaleUnavailable) {
    const outstanding = await fetchOutstandingBalanceUsd(customerId, shopId)
    if (batchTotalUsd > outstanding + 0.001) {
      throw new Error(`المبلغ المدخل يتجاوز رصيد العميل المستحق`)
    }
  }

  const write = async (): Promise<{ totalPaid: number }> => {
    // One transaction: either all allocations land or none do.
    await db.writeTransaction(async (tx) => {
      for (const alloc of allocations) {
        await tx.execute(
          `INSERT INTO customer_payments
             (id, shop_id, customer_id, sale_id, amount_usd, currency, amount_raw, method,
              exchange_rate_at_payment, notes, paid_at, created_at, shift_id, device_id, sync_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, null, ?, ?, ?, ?, 'pending')`,
          [
            uuidv4(), shopId, customerId, alloc.saleId,
            alloc.amountUsd, alloc.currency, alloc.amountRaw, alloc.method,
            alloc.exchangeRateAtPayment ?? null,
            now.slice(0, 10), now,
            shiftId, deviceId,
          ],
        )
      }
    })
    return { totalPaid: batchTotalUsd }
  }

  await executeBusinessOperation(write, {
    audit: async ({ totalPaid }) => {
      await audit.logCustomerPaymentRecorded(customerId, totalPaid)
    },
    // TODO(WAFI-140): remainingBalance is not the true post-payment balance —
    // computing it requires a second query after publish (below), deferred
    // until the event actually has a subscriber. Not worth the complexity for
    // a stub event nobody consumes yet.
    toEvent: () => ({
      type: CustomerEventType.InstallmentDuePaid,
      entityId: customerId,
      payload: { customerId, amount: batchTotalUsd, remainingBalance: 0 },
      staffId: '',
      shopId,
      occurredAt: now,
    }),
  })

  const balanceUsd = await fetchOutstandingBalanceUsd(customerId, shopId)
  return { balanceUsd, pendingSyncCount: 0 }
}
