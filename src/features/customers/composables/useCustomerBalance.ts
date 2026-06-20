import { ref } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import type { OpenInvoice, PaymentAllocation, CustomerPayment } from '@/features/customers/customer.types'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'

type InvoiceRow = {
  id: string; display_sale_number: string; created_at: string
  total_usd: number; remaining_usd: number
}

type PaymentRow = {
  id: string; customer_id: string; sale_id: string; amount_usd: number
  currency: string; method: string | null; paid_at: string; created_at: string
}

// Customer's outstanding balance (USD): credit-sale totals, less payments, less
// returned goods. Shared by load() and recordPayment()'s offline-safe guard so
// the two can never drift. Params: [customerId, shopId] repeated three times.
const BALANCE_USD_SQL = `SELECT
        (SELECT COALESCE(SUM(total_usd), 0)  FROM sales            WHERE customer_id = ? AND is_credit = 1 AND shop_id = ?)
        -
        (SELECT COALESCE(SUM(amount_usd), 0) FROM customer_payments WHERE customer_id = ?                   AND shop_id = ?)
        -
        -- Returned goods reduce what the customer owes, regardless of refund method.
        (SELECT COALESCE(SUM(r.refund_amount_usd), 0) FROM returns r
           JOIN sales s ON s.id = r.original_sale_id
          WHERE s.customer_id = ? AND s.is_credit = 1 AND r.shop_id = ?)
        AS balance_usd`

async function fetchOutstandingBalanceUsd(customerId: string, shopId: string): Promise<number> {
  const row = await db.getOptional<{ balance_usd: number }>(
    BALANCE_USD_SQL,
    [customerId, shopId, customerId, shopId, customerId, shopId]
  )
  return row?.balance_usd ?? 0
}

export function useCustomerBalance(customerId: string) {
  const balanceUsd   = ref(0)
  const openInvoices = ref<OpenInvoice[]>([])
  const payments     = ref<CustomerPayment[]>([])
  const { logCustomerPaymentRecorded } = useAuditLog()

  async function load() {
    const device = useDeviceStore()
    const shopId = device.shopId

    balanceUsd.value = await fetchOutstandingBalanceUsd(customerId, shopId)

    const invoiceRows = await db.getAll<InvoiceRow>(
      `SELECT s.id, s.display_sale_number, s.created_at, s.total_usd,
         s.total_usd
           - COALESCE(SUM(cp.amount_usd), 0)
           - COALESCE((SELECT SUM(r.refund_amount_usd) FROM returns r WHERE r.original_sale_id = s.id), 0)
           AS remaining_usd
       FROM sales s
       LEFT JOIN customer_payments cp ON cp.sale_id = s.id
       WHERE s.customer_id = ? AND s.is_credit = 1 AND s.shop_id = ?
       GROUP BY s.id
       HAVING remaining_usd > 0.001
       ORDER BY s.created_at DESC`,
      [customerId, shopId]
    )

    const invoicesWithSummary: OpenInvoice[] = await Promise.all(
      invoiceRows.map(async row => {
        const itemRows = await db.getAll<{ name_ar: string }>(
          `SELECT p.name_ar FROM sale_line_items sli
           JOIN products p ON p.id = sli.product_id
           WHERE sli.sale_id = ? AND (p.deleted = 0 OR p.deleted IS NULL) LIMIT 2`,
          [row.id]
        )
        return {
          saleId:        row.id,
          displayNumber: row.display_sale_number,
          saleDate:      row.created_at,
          totalUsd:      row.total_usd,
          remainingUsd:  row.remaining_usd,
          itemsSummary:  itemRows.map(r => r.name_ar).join('، '),
        }
      })
    )
    openInvoices.value = invoicesWithSummary

    const paymentRows = await db.getAll<PaymentRow>(
      `SELECT id, customer_id, sale_id, amount_usd, currency, method, paid_at, created_at
       FROM customer_payments WHERE customer_id = ? AND shop_id = ? ORDER BY created_at DESC`,
      [customerId, shopId]
    )
    payments.value = paymentRows.map(r => ({
      id:         r.id,
      customerId: r.customer_id,
      saleId:     r.sale_id,
      amountUsd:  r.amount_usd,
      currency:   r.currency as 'USD' | 'SYP',
      method:     (r.method as CustomerPayment['method']) ?? null,
      paidAt:     r.paid_at,
      createdAt:  r.created_at,
    }))
  }

  async function recordPayment(allocations: PaymentAllocation[]): Promise<void> {
    const device = useDeviceStore()
    const now    = new Date().toISOString()

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
        [alloc.saleId]
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
      const outstanding = await fetchOutstandingBalanceUsd(customerId, device.shopId)
      if (batchTotalUsd > outstanding + 0.001) {
        throw new Error(`المبلغ المدخل يتجاوز رصيد العميل المستحق`)
      }
    }

    // One transaction: either all allocations land or none do.
    await db.writeTransaction(async (tx) => {
      for (const alloc of allocations) {
        await tx.execute(
          `INSERT INTO customer_payments
             (id, shop_id, customer_id, sale_id, amount_usd, currency, amount_raw, method,
              exchange_rate_at_payment, notes, paid_at, created_at, sync_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, null, ?, ?, 'pending')`,
          [
            uuidv4(), device.shopId, customerId, alloc.saleId,
            alloc.amountUsd, alloc.currency, alloc.amountRaw, alloc.method,
            alloc.exchangeRateAtPayment ?? null,
            now.slice(0, 10), now,
          ]
        )
      }
    })
    const totalPaid = allocations.reduce((sum, a) => sum + a.amountUsd, 0)
    await logCustomerPaymentRecorded(customerId, totalPaid)
    await load()
  }

  return { balanceUsd, openInvoices, payments, load, recordPayment }
}
