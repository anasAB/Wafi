import { ref, computed } from 'vue'
import { useDeviceStore } from '@/store/device.store'
import { useSessionStore } from '@/store/session.store'
import type { ReceivingLine } from '../receiving.types'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'
import { receiveStock } from '@/services/inventory.service'

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

    await receiveStock(shopId, staffId, {
      supplierId: supplierId.value,
      supplierName: supplierName.value,
      lines: [...lines.value],
      invoicePhotoUrl: invoicePhotoUrl.value,
      notes: notes.value,
    }, { logReceivingCreated })
  }

  return {
    supplierId, supplierName, lines, invoicePhotoUrl, notes,
    totalCostUsd, canConfirm, addLine, removeLine, updateLine, confirm,
  }
}
