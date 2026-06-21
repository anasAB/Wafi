/**
 * Convert a Blob to a base64 `data:` URI.
 *
 * Product/receiving photos are stored in the database (`products.photo_url`) and
 * synced like any text column. A `blob:` object URL is only valid for the document
 * that created it — it dies on reload and never reaches another device (WAFI-008),
 * so the bytes must be inlined as a data URI instead.
 */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read image'))
    reader.readAsDataURL(blob)
  })
}
