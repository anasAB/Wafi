import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { usePrinter } from '@/composables/usePrinter'
import type { ReceiptData } from '@/composables/usePrinter'
import type { SaleRecord } from './sale-history.types'

export async function buildReceiptData(saleId: string): Promise<ReceiptData> {
  const device = useDeviceStore()
  const [saleRes, linesRes, settingsRes, paymentsRes, fullyReturnedRes] = await Promise.all([
    db.execute(`SELECT * FROM sales WHERE id = ?`, [saleId]),
    // LEFT JOIN so a since-deleted product still reprints its line.
    db.execute(`SELECT sli.*, p.name_ar FROM sale_line_items sli LEFT JOIN products p ON sli.product_id = p.id WHERE sli.sale_id = ?`, [saleId]),
    // Real shop name/header/footer/tax — not the shop UUID.
    db.execute(`SELECT * FROM receipt_settings WHERE shop_id = ? LIMIT 1`, [device.shopId]),
    // Split-payment legs, so a reprint of a split sale shows the same breakdown.
    db.execute(`SELECT method, amount_usd FROM sale_payments WHERE sale_id = ?`, [saleId]),
    // Was every sold unit returned? Then mark the reprint as fully returned.
    db.execute(
      `SELECT r.original_sale_id AS sale_id
       FROM returns r
       JOIN return_line_items rli ON rli.return_id = r.id
       WHERE r.original_sale_id = ?
       GROUP BY r.original_sale_id
       HAVING COALESCE(SUM(rli.qty_returned), 0) >= (
         SELECT COALESCE(SUM(sli.quantity), 0) FROM sale_line_items sli WHERE sli.sale_id = ?
       )`,
      [saleId, saleId],
    ).catch(() => ({ rows: { _array: [] } })),
  ])
  const sale  = ((saleRes as any).rows._array as any[])[0]
  const lines = (linesRes as any).rows._array as any[]
  if (!sale) throw new Error('Sale not found')

  const settings        = ((settingsRes as any).rows._array as any[])[0]
  const paymentRows     = (paymentsRes as any).rows._array as any[]
  const isFullyReturned = ((fullyReturnedRes as any).rows._array as any[]).length > 0

  return {
    saleId:            sale.id,
    displaySaleNumber: sale.display_sale_number,
    shopName:          settings?.shop_name || device.shopId,
    createdAt:         sale.created_at,
    lines: lines.map((l: any) => ({
      nameAr:       l.name_ar ?? '—',
      quantity:     l.quantity,
      unitPriceUsd: l.unit_price_usd,
      lineTotalUsd: l.line_total_usd,
    })),
    totalUsd:       sale.total_usd,
    totalSyp:       sale.total_syp,
    exchangeRate:   sale.exchange_rate_at_sale,
    paymentMethod:  sale.payment_method,
    amountReceived: sale.amount_received,
    amountReceivedCurrency: sale.amount_received_currency,
    changeDue:      sale.change_due ?? undefined,
    taxNumber:      settings?.tax_number  || undefined,
    headerText:     settings?.header_text || undefined,
    footerText:     settings?.footer_text || undefined,
    splitPayments:  (sale.is_split ?? 0) === 1
      ? paymentRows.map((p: any) => ({ method: p.method, amountUsd: p.amount_usd }))
      : undefined,
    isFullyReturned,
  }
}

export function useSaleHistory() {
  const sales   = ref<SaleRecord[]>([])
  const loading = ref(false)
  const error   = ref<string | null>(null)
  const printer = usePrinter()

  async function loadHistory(dateRange?: { start: string; end: string }) {
    const device = useDeviceStore()
    loading.value = true
    error.value   = null
    try {
      let query: string
      let params: string[]

      if (dateRange) {
        // Period-based filter using local date (YYYY-MM-DD)
        // 'localtime' modifier works correctly in PowerSync's wa-sqlite build (maps to browser timezone)
        query  = `SELECT * FROM sales WHERE shop_id = ? AND DATE(created_at, 'localtime') BETWEEN ? AND ? ORDER BY created_at DESC`
        params = [device.shopId, dateRange.start, dateRange.end]
      } else {
        // Default: last 7 days
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        query  = `SELECT * FROM sales WHERE shop_id = ? AND created_at >= ? ORDER BY created_at DESC`
        params = [device.shopId, sevenDaysAgo]
      }

      const [result, crudResult, returnedSalesResult, fullyReturnedResult] = await Promise.all([
        db.execute(query, params),
        db.execute(
          `SELECT DISTINCT json_extract(data, '$.id') as sale_id FROM ps_crud WHERE "table" = 'sales'`
        ).catch(() => ({ rows: { _array: [] } })),
        db.execute(
          `SELECT DISTINCT original_sale_id AS sale_id
           FROM returns
           WHERE shop_id = ?`,
          [device.shopId]
        ).catch(() => ({ rows: { _array: [] } })),
        db.execute(
          `SELECT r.original_sale_id AS sale_id
           FROM returns r
           JOIN return_line_items rli ON rli.return_id = r.id
           WHERE r.shop_id = ?
           GROUP BY r.original_sale_id
           HAVING COALESCE(SUM(rli.qty_returned), 0) >= (
             SELECT COALESCE(SUM(sli.quantity), 0)
             FROM sale_line_items sli
             WHERE sli.sale_id = r.original_sale_id
           )`,
          [device.shopId]
        ).catch(() => ({ rows: { _array: [] } })),
      ])
      const pendingIds = new Set<string>(
        ((crudResult as any).rows._array as any[]).map((r: any) => r.sale_id).filter(Boolean)
      )
      const returnRows = (returnedSalesResult as any).rows._array as any[]
      const fullyReturnedRows = (fullyReturnedResult as any).rows._array as any[]
      const returnedIds = new Set<string>(
        returnRows.map((r: any) => r.sale_id).filter(Boolean)
      )
      const fullyReturnedIds = new Set<string>(
        fullyReturnedRows.map((r: any) => r.sale_id).filter(Boolean)
      )
      sales.value = ((result as any).rows._array as any[]).map(r => ({
        id:                  r.id,
        shopId:              r.shop_id,
        deviceId:            r.device_id,
        deviceSequence:      r.device_sequence,
        displaySaleNumber:   r.display_sale_number,
        createdAt:           r.created_at,
        totalUsd:            r.total_usd,
        totalSyp:            r.total_syp,
        exchangeRateAtSale:  r.exchange_rate_at_sale,
        paymentMethod:       r.payment_method,
        amountReceived:      r.amount_received,
        amountReceivedCurrency: r.amount_received_currency,
        changeDue:           r.change_due,
        isPending:           pendingIds.has(r.id),
        isSplit:             (r.is_split ?? 0) === 1,
        hasReturn:           returnedIds.has(r.id),
        isFullyReturned:     fullyReturnedIds.has(r.id),
      }))
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  async function reprint(saleId: string): Promise<void> {
    const receipt = await buildReceiptData(saleId)
    await printer.print(receipt)
  }

  return { sales, loading, error, loadHistory, reprint, reprintError: printer.error }
}
