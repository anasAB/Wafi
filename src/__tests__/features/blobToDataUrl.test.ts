import { describe, it, expect } from 'vitest'
import { blobToDataUrl } from '@/features/products/blobToDataUrl'

describe('blobToDataUrl (WAFI-008)', () => {
  it('converts a blob to a base64 data: URI, not a document-scoped blob: URL', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/webp' })
    const result = await blobToDataUrl(blob)
    expect(result.startsWith('data:image/webp;base64,')).toBe(true)
    expect(result.startsWith('blob:')).toBe(false)
  })

  it('round-trips the original image bytes through the data URI', async () => {
    const bytes = new Uint8Array([10, 20, 30, 40, 50, 255, 0])
    const blob = new Blob([bytes], { type: 'image/webp' })
    const dataUrl = await blobToDataUrl(blob)
    const decoded = Uint8Array.from(atob(dataUrl.split(',')[1]), c => c.charCodeAt(0))
    expect(Array.from(decoded)).toEqual(Array.from(bytes))
  })
})
