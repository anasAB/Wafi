import { ref } from 'vue'

// USB scanner threshold: ≥ 30 chars/sec means < 33ms between keystrokes
const SCANNER_INTERVAL_MS = 33

type ScanCallback = (barcode: string) => void

export function useBarcodeScan() {
  const cameraAvailable = ref(
    typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
  )

  let buffer:    string  = ''
  let lastTime:  number  = 0
  let inBurst:   boolean = false
  let callbacks: ScanCallback[] = []

  function handleKeyDown(e: KeyboardEvent) {
    const now = e.timeStamp

    if (e.key === 'Enter') {
      if (buffer.length >= 4 && inBurst) {
        e.preventDefault()
        callbacks.forEach(cb => cb(buffer))
      }
      buffer   = ''
      lastTime = 0
      inBurst  = false
      return
    }

    if (e.key.length === 1) {
      if (buffer.length === 0) {
        buffer   = e.key
        lastTime = now
        inBurst  = false
      } else {
        const interval = now - lastTime
        if (interval < SCANNER_INTERVAL_MS) {
          inBurst  = true
          e.preventDefault()
          buffer  += e.key
          lastTime = now
        } else {
          buffer   = e.key
          lastTime = now
          inBurst  = false
        }
      }
    }
  }

  document.addEventListener('keydown', handleKeyDown)

  function onScan(cb: ScanCallback) {
    callbacks.push(cb)
  }

  function offScan(cb: ScanCallback) {
    callbacks = callbacks.filter(c => c !== cb)
  }

  function destroy() {
    document.removeEventListener('keydown', handleKeyDown)
    callbacks = []
    buffer    = ''
    lastTime  = 0
    inBurst   = false
  }

  async function startCamera(videoEl: HTMLVideoElement, onResult: ScanCallback): Promise<() => void> {
    if (!cameraAvailable.value) throw new Error('Camera not available')
    const { BrowserMultiFormatReader } = await import('@zxing/browser')
    const codeReader = new BrowserMultiFormatReader()
    const controls   = await codeReader.decodeFromVideoDevice(undefined, videoEl, (result) => {
      if (result) onResult(result.getText())
    })
    return () => controls.stop()
  }

  return { cameraAvailable, onScan, offScan, startCamera, destroy }
}
