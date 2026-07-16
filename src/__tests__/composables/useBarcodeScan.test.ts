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

describe('useBarcodeScan focus guard', () => {
  it('calls e.preventDefault() on burst chars from the 2nd char onward', () => {
    const { onScan, destroy } = useBarcodeScan()
    onScan(() => {})

    const events: (KeyboardEvent & { preventDefault: ReturnType<typeof vi.fn> })[] = []
    const now = 0

    ;['1','2','3','4','5','6','7','8'].forEach((key, i) => {
      const e = new KeyboardEvent('keydown', { key, cancelable: true })
      Object.defineProperty(e, 'timeStamp', { value: now + i * 10 })
      e.preventDefault = vi.fn()
      events.push(e as any)
      document.dispatchEvent(e)
    })

    // Characters 2-8 (index 1-7) must have preventDefault called
    events.slice(1).forEach(e => {
      expect(e.preventDefault).toHaveBeenCalled()
    })
    expect(events[0].preventDefault).not.toHaveBeenCalled()
    destroy()
  })

  it('does NOT call e.preventDefault() on Enter after a short burst (< 4 chars)', () => {
    const { onScan, destroy } = useBarcodeScan()
    onScan(() => {})

    const now = 0
    ;['1','2','3'].forEach((key, i) => {
      const e = new KeyboardEvent('keydown', { key })
      Object.defineProperty(e, 'timeStamp', { value: now + i * 10 })
      document.dispatchEvent(e)
    })

    const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
    Object.defineProperty(enter, 'timeStamp', { value: now + 3 * 10 })
    enter.preventDefault = vi.fn()
    document.dispatchEvent(enter)

    expect(enter.preventDefault).not.toHaveBeenCalled()
    destroy()
  })

  it('calls e.preventDefault() on the terminating Enter of a scanner burst', () => {
    const { onScan, destroy } = useBarcodeScan()
    onScan(() => {})

    const now = 0
    ;['1','2','3','4'].forEach((key, i) => {
      const e = new KeyboardEvent('keydown', { key })
      Object.defineProperty(e, 'timeStamp', { value: now + i * 10 })
      document.dispatchEvent(e)
    })

    const enter = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true })
    Object.defineProperty(enter, 'timeStamp', { value: now + 4 * 10 })
    enter.preventDefault = vi.fn()
    document.dispatchEvent(enter)

    expect(enter.preventDefault).toHaveBeenCalled()
    destroy()
  })
})

describe('useBarcodeScan lifecycle + terminators (WAFI-032)', () => {
  function burst(keys: string[], terminator: string) {
    keys.forEach((key, i) => {
      const e = new KeyboardEvent('keydown', { key, cancelable: true })
      Object.defineProperty(e, 'timeStamp', { value: i * 10 })
      document.dispatchEvent(e)
    })
    const t = new KeyboardEvent('keydown', { key: terminator, cancelable: true })
    Object.defineProperty(t, 'timeStamp', { value: keys.length * 10 })
    document.dispatchEvent(t)
  }

  it('commits a burst terminated by Tab, not only Enter', () => {
    const cb = vi.fn()
    const { onScan, destroy } = useBarcodeScan()
    onScan(cb)
    burst(['1','2','3','4','5','6'], 'Tab')
    expect(cb).toHaveBeenCalledWith('123456')
    destroy()
  })

  it('trims surrounding whitespace from the committed barcode', () => {
    const cb = vi.fn()
    const { onScan, destroy } = useBarcodeScan()
    onScan(cb)
    burst(['1','2','3','4',' '], 'Enter')
    expect(cb).toHaveBeenCalledWith('1234')
    destroy()
  })

  it('destroy() detaches the keydown listener so a later scan does not fire (no leak)', () => {
    const cb = vi.fn()
    const { onScan, destroy } = useBarcodeScan()
    onScan(cb)
    destroy()
    burst(['1','2','3','4','5','6'], 'Enter')
    expect(cb).not.toHaveBeenCalled()
  })
})

describe('useBarcodeScan does not block a real search input\'s Enter-to-submit', () => {
  it('a human typing a search term and pressing Enter still submits the search', async () => {
    const scanCb = vi.fn()
    const { onScan, destroy } = useBarcodeScan()
    onScan(scanCb)

    // A real <input> with its own local Enter handler, mirroring POSSaleScreen.vue's
    // search bar: v-model + a submit handler bound to the Enter key.
    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()

    const submitHandler = vi.fn()
    input.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') submitHandler()
    })

    // Human typing speed: ~150ms between keystrokes (far above the 33ms scanner threshold).
    const term = 'قهوة'
    let t = 0
    for (const ch of term) {
      const down = new KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true })
      Object.defineProperty(down, 'timeStamp', { value: t })
      input.dispatchEvent(down)
      const up = new KeyboardEvent('keyup', { key: ch, bubbles: true, cancelable: true })
      input.dispatchEvent(up)
      t += 150
    }
    const enterDown = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    Object.defineProperty(enterDown, 'timeStamp', { value: t })
    input.dispatchEvent(enterDown)
    const enterUp = new KeyboardEvent('keyup', { key: 'Enter', bubbles: true, cancelable: true })
    input.dispatchEvent(enterUp)

    // The global scanner handler must NOT have treated this as a scan...
    expect(scanCb).not.toHaveBeenCalled()
    // ...and the input's own local Enter-to-submit handler must still have fired.
    expect(submitHandler).toHaveBeenCalledTimes(1)

    document.body.removeChild(input)
    destroy()
  })
})
