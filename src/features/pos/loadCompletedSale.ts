import { db } from '@/data/powersync/db'
import type { CompletedSale, SplitPaymentEntry } from '@/features/payment/payment.types'

/**
 * Rebuild a {@link CompletedSale} from the local DB by id.
 *
 * The confirmation screen normally receives the sale via `history.state`, but a
 * reload / app-kill on `/pos/confirmation` loses that state (WAFI-030). The sale
 * itself is persisted, so we reconstruct the view model — header, line items
 * (with product names), and any split-payment legs — from the database instead of
 * rendering empty placeholders.
 *
 * Returns null if no sale matches the id.
 */
export async function loadCompletedSale(saleId: string): Promise<CompletedSale | null> {
  const [saleRes, linesRes, paymentsRes] = await Promise.all([
    db.execute(`SELECT * FROM sales WHERE id = ?`, [saleId]),
    // LEFT JOIN so a since-deleted product doesn't drop its line from the receipt.
    db.execute(
      `SELECT sli.quantity, sli.unit_price_usd, sli.line_total_usd, p.name_ar
       FROM sale_line_items sli LEFT JOIN products p ON sli.product_id = p.id
       WHERE sli.sale_id = ?`,
      [saleId],
    ),
    db.execute(
      `SELECT method, amount_raw, currency, amount_usd, exchange_rate, change_due
       FROM sale_payments WHERE sale_id = ?`,
      [saleId],
    ),
  ])

  const sale = ((saleRes as any).rows._array as any[])[0]
  if (!sale) return null

  const lines = ((linesRes as any).rows._array as any[]).map(l => ({
    nameAr:       l.name_ar ?? '—',
    quantity:     l.quantity,
    unitPriceUsd: l.unit_price_usd,
    lineTotalUsd: l.line_total_usd,
  }))

  const paymentRows = (paymentsRes as any).rows._array as any[]
  const splitPayments: SplitPaymentEntry[] | undefined =
    (sale.is_split ?? 0) === 1
      ? paymentRows.map(p => ({
          method:       p.method,
          amountRaw:    p.amount_raw,
          currency:     p.currency,
          amountUsd:    p.amount_usd,
          exchangeRate: p.exchange_rate,
          changeDue:    p.change_due ?? 0,
        }))
      : undefined

  return {
    saleId:                 sale.id,
    displaySaleNumber:      sale.display_sale_number,
    totalUsd:               sale.total_usd,
    totalSyp:               sale.total_syp,
    exchangeRateAtSale:     sale.exchange_rate_at_sale,
    paymentMethod:          sale.payment_method,
    amountReceived:         sale.amount_received ?? undefined,
    amountReceivedCurrency: sale.amount_received_currency ?? undefined,
    changeDue:              sale.change_due ?? undefined,
    createdAt:              sale.created_at,
    customerId:             sale.customer_id ?? undefined,
    lines,
    splitPayments,
  }
}
