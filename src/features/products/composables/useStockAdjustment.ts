import { ref } from 'vue'
import type { AdjustmentReason } from '@/features/products/product.types'

export function useStockAdjustment() {
  const isOpen             = ref(false)
  const reason             = ref<AdjustmentReason>('stocktake')
  const notes              = ref('')
  const pendingProductId   = ref<string | null>(null)
  const pendingProductName = ref('')
  const pendingOldValue    = ref(0)
  const pendingNewValue    = ref(0)

  function open(productId: string, productName: string, oldValue: number, newValue: number) {
    pendingProductId.value   = productId
    pendingProductName.value = productName
    pendingOldValue.value    = oldValue
    pendingNewValue.value    = newValue
    reason.value             = 'stocktake'
    notes.value              = ''
    isOpen.value             = true
  }

  function cancel() {
    isOpen.value = false
  }

  return { isOpen, reason, notes, pendingProductId, pendingProductName, pendingOldValue, pendingNewValue, open, cancel }
}
