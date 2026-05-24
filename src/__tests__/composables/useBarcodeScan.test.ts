import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useBarcodeScan } from '@/composables/useBarcodeScan'

function fireKeySequence(keys: string[], intervalMs: number) {
  const now = performance.now()
  keys.forEach((key, i) => {
    const event = new KeyboardEvent('keydown', { key })
    Object.defineProperty(event, 'timeStamp', { value: now + i * intervalMs })
    document.dispatchEvent(event)
  })
  const enter = new KeyboardEvent('keydown', { key: 'Enter' })
  Object.defineProperty(enter, 'timeStamp', { value: now + keys.length * intervalMs })
  document.dispatchEvent(enter)
}

describe('useBarcodeScan USB detection', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('calls callback for burst ≥ 30 chars/sec (< 33ms per char)', () => {
    const cb = vi.fn()
    const { onScan, destroy } = useBarcodeScan()
    onScan(cb)

    // 8 chars at ~10ms each = 100 chars/sec (scanner speed)
    fireKeySequence(['1', '2', '3', '4', '5', '6', '7', '8'], 10)

    expect(cb).toHaveBeenCalledWith('12345678')
    destroy()
  })

  it('does NOT call callback for slow human typing (> 33ms per char)', () => {
    const cb = vi.fn()
    const { onScan, destroy } = useBarcodeScan()
    onScan(cb)

    // 4 chars at 100ms each = 10 chars/sec (human speed)
    fireKeySequence(['A', 'B', 'C', 'D'], 100)

    expect(cb).not.toHaveBeenCalled()
    destroy()
  })
})
