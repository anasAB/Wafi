import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { usePrinter } from '@/composables/usePrinter'
import type { ReceiptData } from '@/composables/usePrinter'
import type { SaleRecord, SaleLineRecord } from './sale-history.types'

export function useSaleHistory() {
  const sales   = ref<SaleRecord[]>([])
  const loading = ref(false)
  const error   = ref<string | null>(null)
  const printer = usePrinter()

  async function loadHistory() {
    const device = useDeviceStore()
    loading.value = true
    error.value   = null
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
      const result = await db.execute(
        `SELECT * FROM sales WHERE shop_id = ? AND created_at >= ? ORDER BY created_at DESC`,
        [device.shopId, sevenDaysAgo]
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
      }))
    } finally {
      loading.value = false
    }
  }

  async function reprint(saleId: string): Promise<void> {
    const device = useDeviceStore()
    const [saleRes, linesRes] = await Promise.all([
      db.execute(`SELECT * FROM sales WHERE id = ?`, [saleId]),
      db.execute(`SELECT sli.*, p.name_ar FROM sale_line_items sli JOIN products p ON sli.product_id = p.id WHERE sli.sale_id = ?`, [saleId]),
    ])
    const sale  = ((saleRes as any).rows._array as any[])[0]
    const lines = (linesRes as any).rows._array as any[]
    if (!sale) throw new Error('Sale not found')

    const receipt: ReceiptData = {
      saleId:            sale.id,
      displaySaleNumber: sale.display_sale_number,
      shopName:          device.shopId,
      createdAt:         sale.created_at,
      lines: lines.map((l: any) => ({
        nameAr:       l.name_ar,
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
      changeDue:      sale.change_due,
    }
    await printer.print(receipt)
  }

  return { sales, loading, error, loadHistory, reprint, reprintError: printer.error }
}
