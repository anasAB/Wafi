import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import type { InvoiceLineItem, CustomerPayment } from '@/features/customers/customer.types'

type LineRow = {
  name_ar: string | null
  quantity: number
  unit_price_usd: number
  line_total_usd: number
}

type PaymentRow = {
  id: string; customer_id: string; sale_id: string; amount_usd: number
  currency: string; paid_at: string; created_at: string
}

/**
 * Loads the line items and recorded payments for a single sale/invoice so the
 * owner can review what a credit invoice was made of.
 */
export function useInvoiceDetail() {
  const lines    = ref<InvoiceLineItem[]>([])
  const payments = ref<CustomerPayment[]>([])
  const loading  = ref(false)

  async function load(saleId: string) {
    loading.value = true
    try {
      // LEFT JOIN so a line whose product was later deleted still shows up.
      const lineRows = await db.getAll<LineRow>(
        `SELECT p.name_ar, sli.quantity, sli.unit_price_usd, sli.line_total_usd
         FROM sale_line_items sli
         LEFT JOIN products p ON p.id = sli.product_id
         WHERE sli.sale_id = ?`,
        [saleId]
      )
      lines.value = lineRows.map(r => ({
        nameAr:       r.name_ar ?? 'منتج محذوف',
        quantity:     r.quantity,
        unitPriceUsd: r.unit_price_usd,
        lineTotalUsd: r.line_total_usd,
      }))

      const payRows = await db.getAll<PaymentRow>(
        `SELECT id, customer_id, sale_id, amount_usd, currency, paid_at, created_at
         FROM customer_payments WHERE sale_id = ? ORDER BY created_at ASC`,
        [saleId]
      )
      payments.value = payRows.map(r => ({
        id:         r.id,
        customerId: r.customer_id,
        saleId:     r.sale_id,
        amountUsd:  r.amount_usd,
        currency:   r.currency as 'USD' | 'SYP',
        paidAt:     r.paid_at,
        createdAt:  r.created_at,
      }))
    } finally {
      loading.value = false
    }
  }

  return { lines, payments, loading, load }
}
