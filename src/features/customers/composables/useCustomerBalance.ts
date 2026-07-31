import { computed, ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { useShiftStore } from '@/features/shifts/shift.store'
import type { OpenInvoice, PaymentAllocation, CustomerPayment } from '@/features/customers/customer.types'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'
import { recordPayment as recordPaymentService } from '@/services/customer.service'

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
        -
        -- A store-credit refund on a CASH sale isn't a debt reduction — it's a credit
        -- the shop owes the customer. Subtract it too so the balance goes negative,
        -- which the detail page renders as "customer credit" (WAFI-026/027).
        (SELECT COALESCE(SUM(r.refund_amount_usd), 0) FROM returns r
           JOIN sales s ON s.id = r.original_sale_id
          WHERE s.customer_id = ? AND s.is_credit = 0 AND r.refund_method = 'store_credit' AND r.shop_id = ?)
        AS balance_usd`

const PENDING_SYNC_COUNT_SQL = `SELECT
        (SELECT COALESCE(COUNT(*), 0) FROM sales
          WHERE customer_id = ? AND is_credit = 1 AND sync_status = 'pending' AND shop_id = ?)
        +
        (SELECT COALESCE(COUNT(*), 0) FROM customer_payments
          WHERE customer_id = ? AND sync_status = 'pending' AND shop_id = ?)
        AS pending_sync_count`

export async function fetchOutstandingBalanceUsd(customerId: string, shopId: string): Promise<number> {
  const row = await db.getOptional<{ balance_usd: number }>(
    BALANCE_USD_SQL,
    [customerId, shopId, customerId, shopId, customerId, shopId, customerId, shopId]
  )
  return row?.balance_usd ?? 0
}

export function useCustomerBalance(customerId: string) {
  const balanceUsd   = ref(0)
  const pendingSyncCount = ref(0)
  const hasPendingSync = computed(() => pendingSyncCount.value > 0)
  const openInvoices = ref<OpenInvoice[]>([])
  const payments     = ref<CustomerPayment[]>([])
  const { logCustomerPaymentRecorded } = useAuditLog()

  async function load() {
    const device = useDeviceStore()
    const shopId = device.shopId

    balanceUsd.value = await fetchOutstandingBalanceUsd(customerId, shopId)
    const pendingRow = await db.getOptional<{ pending_sync_count: number }>(
      PENDING_SYNC_COUNT_SQL,
      [customerId, shopId, customerId, shopId]
    )
    pendingSyncCount.value = Number(pendingRow?.pending_sync_count ?? 0)

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
    // WAFI-120: drawer attribution — a CASH collection puts physical money in
    // the drawer, so every payment row carries the open shift + device at write
    // time (null shift when none is open — legacy/no-shift rows fall back to
    // the Z-report's time-window scoping).
    const shiftStore = useShiftStore()
    await recordPaymentService(
      device.shopId, customerId, allocations,
      { logCustomerPaymentRecorded }, shiftStore.activeShiftId, device.deviceId,
    )
    await load()
  }

  return {
    balanceUsd,
    pendingSyncCount,
    hasPendingSync,
    openInvoices,
    payments,
    load,
    recordPayment,
  }
}
