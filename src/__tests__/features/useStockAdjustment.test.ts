import { describe, it, expect } from 'vitest'
import { useStockAdjustment } from '@/features/products/composables/useStockAdjustment'

describe('useStockAdjustment', () => {
  it('starts closed', () => {
    const { isOpen } = useStockAdjustment()
    expect(isOpen.value).toBe(false)
  })

  it('open sets pending values and shows dialog', () => {
    const { isOpen, pendingProductId, pendingOldValue, pendingNewValue, pendingProductName, open } =
      useStockAdjustment()
    open('p1', 'كابل HDMI', 10, 8)
    expect(isOpen.value).toBe(true)
    expect(pendingProductId.value).toBe('p1')
    expect(pendingProductName.value).toBe('كابل HDMI')
    expect(pendingOldValue.value).toBe(10)
    expect(pendingNewValue.value).toBe(8)
  })

  it('cancel closes dialog', () => {
    const { isOpen, open, cancel } = useStockAdjustment()
    open('p1', 'منتج', 10, 8)
    cancel()
    expect(isOpen.value).toBe(false)
  })

  it('open resets reason to stocktake and clears notes', () => {
    const { reason, notes, open } = useStockAdjustment()
    reason.value = 'damaged'
    notes.value  = 'ملاحظة'
    open('p1', 'منتج', 10, 8)
    expect(reason.value).toBe('stocktake')
    expect(notes.value).toBe('')
  })
})
