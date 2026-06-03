import { ref } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import type { OpenInvoice, PaymentAllocation, CustomerPayment } from '@/features/customers/customer.types'

type InvoiceRow = {
  id: string; display_sale_number: string; created_at: string
  total_usd: number; remaining_usd: number
}

type PaymentRow = {
  id: string; customer_id: string; sale_id: string; amount_usd: number
  currency: string; paid_at: string; created_at: string
}

export function useCustomerBalance(customerId: string) {
  const balanceUsd   = ref(0)
  const openInvoices = ref<OpenInvoice[]>([])
  const payments     = ref<CustomerPayment[]>([])

  async function load() {
    const device = useDeviceStore()
    const shopId = device.shopId

    const balRow = await db.getOptional<{ balance_usd: number }>(
      `SELECT
        (SELECT COALESCE(SUM(total_usd), 0)  FROM sales            WHERE customer_id = ? AND is_credit = 1 AND shop_id = ?)
        -
        (SELECT COALESCE(SUM(amount_usd), 0) FROM customer_payments WHERE customer_id = ?                   AND shop_id = ?)
        AS balance_usd`,
      [customerId, shopId, customerId, shopId]
    )
    balanceUsd.value = balRow?.balance_usd ?? 0

    const invoiceRows = await db.getAll<InvoiceRow>(
      `SELECT s.id, s.display_sale_number, s.created_at, s.total_usd,
         s.total_usd - COALESCE(SUM(cp.amount_usd), 0) AS remaining_usd
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
      `SELECT id, customer_id, sale_id, amount_usd, currency, paid_at, created_at
       FROM customer_payments WHERE customer_id = ? AND shop_id = ? ORDER BY created_at DESC`,
      [customerId, shopId]
    )
    payments.value = paymentRows.map(r => ({
      id:         r.id,
      customerId: r.customer_id,
      saleId:     r.sale_id,
      amountUsd:  r.amount_usd,
      currency:   r.currency as 'USD' | 'SYP',
      paidAt:     r.paid_at,
      createdAt:  r.created_at,
    }))
  }

  async function recordPayment(allocations: PaymentAllocation[]): Promise<void> {
    const device = useDeviceStore()
    const now    = new Date().toISOString()

    // Guard: do not allow allocation amount to exceed current remaining on invoice
    for (const alloc of allocations) {
      const remRow = await db.getOptional<{ remaining_usd: number }>(
        `SELECT s.total_usd - COALESCE(SUM(cp.amount_usd), 0) AS remaining_usd
         FROM sales s
         LEFT JOIN customer_payments cp ON cp.sale_id = s.id
         WHERE s.id = ?
         GROUP BY s.id`,
        [alloc.saleId]
      )
      // If the sale row is not found locally (null) or remaining_usd is not present on the row,
      // skip the guard — this handles offline / newly synced rows not yet visible.
      if (remRow === null || remRow.remaining_usd === undefined) continue
      if (alloc.amountUsd > remRow.remaining_usd + 0.001) {
        throw new Error(`المبلغ المدخل يتجاوز المبلغ المتبقي للفاتورة`)
      }
    }

    for (const alloc of allocations) {
      await db.execute(
        `INSERT INTO customer_payments
           (id, shop_id, customer_id, sale_id, amount_usd, currency, amount_raw,
            exchange_rate_at_payment, notes, paid_at, created_at, sync_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, null, ?, ?, 'pending')`,
        [
          uuidv4(), device.shopId, customerId, alloc.saleId,
          alloc.amountUsd, alloc.currency, alloc.amountRaw,
          alloc.exchangeRateAtPayment ?? null,
          now.slice(0, 10), now,
        ]
      )
    }
    await load()
  }

  return { balanceUsd, openInvoices, payments, load, recordPayment }
}
