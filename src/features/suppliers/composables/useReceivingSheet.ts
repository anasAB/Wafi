import { ref, computed } from 'vue'
import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { useSessionStore } from '@/store/session.store'
import type { ReceivingLine } from '../receiving.types'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'

// Minimal product shape needed to seed a line (matches useProducts' Product).
interface PickedProduct { id: string; nameAr: string; costPriceUsd: number }

export function useReceivingSheet() {
  const { logReceivingCreated } = useAuditLog()

  const supplierId   = ref<string | null>(null)
  const supplierName = ref<string>('')
  const lines        = ref<ReceivingLine[]>([])
  const invoicePhotoUrl = ref<string | null>(null)
  const notes        = ref('')

  const totalCostUsd = computed(() =>
    lines.value.reduce((sum, l) => sum + l.qtyReceived * l.unitCostUsd, 0),
  )

  const canConfirm = computed(() =>
    supplierId.value !== null &&
    lines.value.length > 0 &&
    lines.value.every(l => l.qtyReceived > 0),
  )

  function addLine(product: PickedProduct): void {
    // Avoid duplicate lines for the same product.
    if (lines.value.some(l => l.productId === product.id)) return
    lines.value.push({
      productId:      product.id,
      productName:    product.nameAr,
      currentCostUsd: product.costPriceUsd,
      qtyReceived:    1,
      unitCostUsd:    product.costPriceUsd,
      updateCost:     true,
    })
  }

  function removeLine(index: number): void {
    lines.value.splice(index, 1)
  }

  // Apply an edit from a line row. The composable owns `lines`, so the row emits
  // its change here rather than mutating the prop object it was handed.
  function updateLine(
    index: number,
    patch: Partial<Pick<ReceivingLine, 'qtyReceived' | 'unitCostUsd' | 'updateCost'>>,
  ): void {
    const line = lines.value[index]
    if (line) Object.assign(line, patch)
  }

  async function confirm(): Promise<void> {
    if (!supplierId.value || lines.value.length === 0 || lines.value.some(l => l.qtyReceived <= 0)) {
      throw new Error('confirm() called without valid state')
    }

    const { shopId } = useDeviceStore()
    const session = useSessionStore()
    const staffId = session.activeStaff?.id ?? null

    // Current exchange rate (read-only lookup, outside transaction).
    const rateResult = await db.execute(
      `SELECT rate FROM exchange_rates WHERE shop_id = ? ORDER BY set_at DESC LIMIT 1`,
      [shopId],
    )
    const exchangeRate: number = (rateResult as any).rows._array[0]?.rate ?? 1

    const receivingId = uuidv4()
    const now = new Date().toISOString()
    const total = totalCostUsd.value
    const snapshotLines = [...lines.value]

    await db.writeTransaction(async (tx) => {
      await tx.execute(
        `INSERT INTO stock_receivings
           (id, shop_id, supplier_id, received_at, invoice_photo_url, total_cost_usd,
            exchange_rate_at_receiving, notes, staff_id, sync_status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [receivingId, shopId, supplierId.value, now, invoicePhotoUrl.value,
         total, exchangeRate, notes.value || null, staffId],
      )

      for (const line of snapshotLines) {
        await tx.execute(
          `INSERT INTO stock_receiving_line_items
             (id, receiving_id, shop_id, product_id, qty_received, unit_cost_usd, cost_updated, sync_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
          [uuidv4(), receivingId, shopId, line.productId, line.qtyReceived,
           line.unitCostUsd, line.updateCost ? 1 : 0],
        )

        // Increment stock.
        const stockResult = await tx.execute(
          `SELECT current_stock FROM products WHERE id = ?`, [line.productId],
        )
        const oldStock: number = (stockResult as any).rows._array[0]?.current_stock ?? 0
        const newStock = oldStock + line.qtyReceived
        await tx.execute(
          `UPDATE products SET current_stock = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
          [newStock, now, line.productId],
        )

        // Update standing cost only if toggled AND the cost is real (WAFI-021): a
        // zero/blank unit cost must never overwrite the product's standing cost — that
        // silently wipes margin on every later sale. Past sale_line_items are untouched.
        if (line.updateCost && line.unitCostUsd > 0) {
          await tx.execute(
            `UPDATE products SET cost_price_usd = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
            [line.unitCostUsd, now, line.productId],
          )
        }
      }
    })

    await logReceivingCreated(receivingId, supplierName.value, total, snapshotLines.length)
  }

  return {
    supplierId, supplierName, lines, invoicePhotoUrl, notes,
    totalCostUsd, canConfirm, addLine, removeLine, updateLine, confirm,
  }
}
