import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import type { Receiving, ReceivingDetailData } from '../receiving.types'

type HeaderRow = {
  id: string; shop_id: string; supplier_id: string; supplier_name: string
  received_at: string; invoice_photo_url: string | null; total_cost_usd: number
  exchange_rate_at_receiving: number; notes: string | null; staff_id: string | null
}

type LineRow = {
  product_id: string; product_name: string; qty_received: number
  unit_cost_usd: number; cost_updated: number
}

function rowToReceiving(r: HeaderRow): Receiving {
  return {
    id: r.id, shopId: r.shop_id, supplierId: r.supplier_id, supplierName: r.supplier_name,
    receivedAt: r.received_at,
    invoicePhotoUrl: r.invoice_photo_url ?? undefined,
    totalCostUsd: r.total_cost_usd,
    exchangeRateAtReceiving: r.exchange_rate_at_receiving,
    notes: r.notes ?? undefined,
    staffId: r.staff_id ?? undefined,
  }
}

const HEADER_SELECT = `
  SELECT sr.*, COALESCE(s.name, '—') AS supplier_name
  FROM stock_receivings sr
  LEFT JOIN suppliers s ON s.id = sr.supplier_id`

export function useReceivings() {
  const receivings = ref<Receiving[]>([])

  async function load() {
    const device = useDeviceStore()
    const rows = await db.getAll<HeaderRow>(
      `${HEADER_SELECT} WHERE sr.shop_id = ? ORDER BY sr.received_at DESC LIMIT 200`,
      [device.shopId],
    )
    receivings.value = rows.map(rowToReceiving)
  }

  async function loadForSupplier(supplierId: string) {
    const device = useDeviceStore()
    const rows = await db.getAll<HeaderRow>(
      `${HEADER_SELECT} WHERE sr.shop_id = ? AND sr.supplier_id = ? ORDER BY sr.received_at DESC`,
      [device.shopId, supplierId],
    )
    receivings.value = rows.map(rowToReceiving)
  }

  async function loadDetail(id: string): Promise<ReceivingDetailData | null> {
    const header = await db.getOptional<HeaderRow>(
      `${HEADER_SELECT} WHERE sr.id = ?`, [id],
    )
    if (!header) return null
    const lineRows = await db.getAll<LineRow>(
      `SELECT li.product_id, COALESCE(p.name_ar, '—') AS product_name,
              li.qty_received, li.unit_cost_usd, li.cost_updated
       FROM stock_receiving_line_items li
       LEFT JOIN products p ON p.id = li.product_id
       WHERE li.receiving_id = ?`,
      [id],
    )
    return {
      header: rowToReceiving(header),
      lines: lineRows.map(l => ({
        productId: l.product_id, productName: l.product_name,
        qtyReceived: l.qty_received, unitCostUsd: l.unit_cost_usd,
        costUpdated: l.cost_updated === 1,
      })),
    }
  }

  return { receivings, load, loadForSupplier, loadDetail }
}
