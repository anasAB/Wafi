import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import type { ReturnDetailRecord, ReturnDetailLine, RefundMethod } from '../returns.types'

type ReturnRow = {
  id: string; created_at: string; refund_method: string
  refund_amount_usd: number; refund_amount_syp: number
  reason: string | null; notes: string | null
}

type LineRow = {
  name_ar: string | null; qty_returned: number
  unit_price_usd: number; restock: number
}

/**
 * Loads every processed return for a sale (read-only) so the owner can review
 * what was sent back — quantities, refund amount, method, reason — even after
 * the sale is fully returned and the "إرجاع" action is no longer offered.
 */
export function useReturnDetail() {
  const returns = ref<ReturnDetailRecord[]>([])
  const loading = ref(false)

  async function load(saleId: string) {
    loading.value = true
    try {
      const returnRows = await db.getAll<ReturnRow>(
        `SELECT id, created_at, refund_method, refund_amount_usd, refund_amount_syp, reason, notes
         FROM returns WHERE original_sale_id = ? ORDER BY created_at ASC`,
        [saleId]
      )

      const records: ReturnDetailRecord[] = []
      for (const r of returnRows) {
        // LEFT JOIN so a returned line whose product was later deleted still shows.
        const lineRows = await db.getAll<LineRow>(
          `SELECT p.name_ar, rli.qty_returned, rli.unit_price_usd, rli.restock
           FROM return_line_items rli
           LEFT JOIN products p ON p.id = rli.product_id
           WHERE rli.return_id = ?`,
          [r.id]
        )
        const lines: ReturnDetailLine[] = lineRows.map(l => ({
          nameAr:       l.name_ar ?? 'منتج محذوف',
          qtyReturned:  l.qty_returned,
          unitPriceUsd: l.unit_price_usd,
          restock:      l.restock === 1,
        }))
        records.push({
          id:              r.id,
          createdAt:       r.created_at,
          refundMethod:    r.refund_method as RefundMethod,
          refundAmountUsd: r.refund_amount_usd,
          refundAmountSyp: r.refund_amount_syp,
          reason:          r.reason,
          notes:           r.notes,
          lines,
        })
      }
      returns.value = records
    } finally {
      loading.value = false
    }
  }

  return { returns, loading, load }
}
