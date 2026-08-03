import { ref } from 'vue'
import { useSettingsStore } from '@/features/settings'

// WAFI-125: detection is configurable (Settings → الماسح الضوئي). These are the
// safe defaults — identical to the previously hardcoded behavior — and the
// fallback when no Pinia app is active (unit tests, early boot).
const DEFAULT_INTERVAL_MS = 33   // ≥ 30 chars/sec means < 33ms between keystrokes
const DEFAULT_MIN_LENGTH  = 4
const DEFAULT_TERMINATOR: ScannerTerminator = 'enter-tab'
// A scanner that sends no terminator still finishes its burst within a few ms —
// after this much silence mid-burst the scan is finalized by timeout.
const BURST_TIMEOUT_MS = 250

export type ScannerTerminator = 'enter-tab' | 'enter' | 'tab' | 'none'

type ScanCallback = (barcode: string) => void

/** WAFI-125: diagnostics stream for the Settings pairing screen. */
export type ScanDiagnosticEvent =
  | { type: 'key'; key: string; intervalMs: number | null }
  | { type: 'commit'; code: string; via: 'terminator' | 'timeout' }
  | { type: 'reject'; code: string; reason: 'too-short' | 'too-slow' }

export function useBarcodeScan() {
  const cameraAvailable = ref(
    typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
  )

  let buffer:    string  = ''
  let lastTime:  number  = 0
  let inBurst:   boolean = false
  let callbacks: ScanCallback[] = []
  let diagnosticCallbacks: Array<(e: ScanDiagnosticEvent) => void> = []
  let burstTimer: ReturnType<typeof setTimeout> | undefined

  // WAFI-125 focus-guard fix: the global listener used to leak the first char
  // of every scan (and entire slow scans) into a focused input. Burst chars
  // from the 2nd on are preventDefault'd; the chars that DID land in a focused
  // editable before the burst was recognized are tracked here and stripped
  // from the field when the scan commits. Human typing never commits, so real
  // input is never touched.
  let leaked: string = ''
  let leakedEl: HTMLElement | null = null

  function config() {
    try {
      const s = useSettingsStore()
      return {
        intervalMs: Number(s.scannerIntervalMs) > 0 ? Number(s.scannerIntervalMs) : DEFAULT_INTERVAL_MS,
        minLength:  Number(s.scannerMinLength)  > 0 ? Number(s.scannerMinLength)  : DEFAULT_MIN_LENGTH,
        terminator: (s.scannerTerminator ?? DEFAULT_TERMINATOR) as ScannerTerminator,
      }
    } catch {
      return { intervalMs: DEFAULT_INTERVAL_MS, minLength: DEFAULT_MIN_LENGTH, terminator: DEFAULT_TERMINATOR }
    }
  }

  function emitDiagnostic(e: ScanDiagnosticEvent) {
    diagnosticCallbacks.forEach(cb => cb(e))
  }

  function isEditable(el: Element | null): boolean {
    if (!el) return false
    const tag = el.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || (el as HTMLElement).isContentEditable
  }

  function stripLeaked() {
    if (!leaked || !leakedEl) { leaked = ''; leakedEl = null; return }
    const el = leakedEl as HTMLInputElement | HTMLTextAreaElement
    if (typeof el.value === 'string' && el.value.endsWith(leaked)) {
      el.value = el.value.slice(0, el.value.length - leaked.length)
      // v-model listens on 'input' — keep the framework state in sync.
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    leaked = ''
    leakedEl = null
  }

  function resetBurst() {
    buffer   = ''
    lastTime = 0
    inBurst  = false
    leaked   = ''
    leakedEl = null
    if (burstTimer) { clearTimeout(burstTimer); burstTimer = undefined }
  }

  function commit(via: 'terminator' | 'timeout') {
    const code = buffer.trim()
    stripLeaked()
    if (burstTimer) { clearTimeout(burstTimer); burstTimer = undefined }
    buffer   = ''
    lastTime = 0
    inBurst  = false
    emitDiagnostic({ type: 'commit', code, via })
    callbacks.forEach(cb => cb(code))
  }

  function armBurstTimeout() {
    if (burstTimer) clearTimeout(burstTimer)
    burstTimer = setTimeout(() => {
      // No-terminator scanners: finalize on silence (edge case in WAFI-125).
      if (inBurst && buffer.length >= config().minLength) commit('timeout')
      else if (buffer) { emitDiagnostic({ type: 'reject', code: buffer, reason: 'too-short' }); resetBurst() }
    }, BURST_TIMEOUT_MS)
  }

  function handleKeyDown(e: KeyboardEvent) {
    // BUG-C01 fix: never start treating keystrokes as a scanner burst while a
    // real text/number field is focused — a scan happens with nothing
    // deliberately focused. Without this guard, fast human typing into any
    // input (Edit Quantity, cost price, ...) got diverted into the barcode
    // buffer. `inBurst` is still honored so a burst already recognized before
    // an unrelated focus change can still commit correctly.
    if (!inBurst && isEditable(document.activeElement)) return

    const now = e.timeStamp
    const cfg = config()

    const isTerminatorKey =
      (e.key === 'Enter' && (cfg.terminator === 'enter-tab' || cfg.terminator === 'enter')) ||
      (e.key === 'Tab'   && (cfg.terminator === 'enter-tab' || cfg.terminator === 'tab'))

    // Terminator commits a qualifying burst; otherwise it's a real Enter/Tab
    // (submit, focus move) and passes through untouched.
    if (e.key === 'Enter' || e.key === 'Tab') {
      if (isTerminatorKey && buffer.length >= cfg.minLength && inBurst) {
        e.preventDefault()
        commit('terminator')
      } else {
        if (buffer && inBurst) emitDiagnostic({ type: 'reject', code: buffer, reason: 'too-short' })
        resetBurst()
      }
      return
    }

    if (e.key.length === 1) {
      if (buffer.length === 0) {
        buffer   = e.key
        lastTime = now
        inBurst  = false
        emitDiagnostic({ type: 'key', key: e.key, intervalMs: null })
        // First char can't be distinguished from typing yet — it lands in a
        // focused field; remember it so a confirmed scan can strip it back out.
        const active = document.activeElement
        if (isEditable(active)) { leaked = e.key; leakedEl = active as HTMLElement }
        armBurstTimeout()
      } else {
        const interval = now - lastTime
        emitDiagnostic({ type: 'key', key: e.key, intervalMs: interval })
        if (interval < cfg.intervalMs) {
          inBurst  = true
          e.preventDefault()
          buffer  += e.key
          lastTime = now
          armBurstTimeout()
        } else {
          if (inBurst) emitDiagnostic({ type: 'reject', code: buffer, reason: 'too-slow' })
          // Burst broke — the previous chars were human typing; forget any
          // leak candidate (stripping real typing would corrupt the field).
          resetBurst()
          buffer   = e.key
          lastTime = now
          const active = document.activeElement
          if (isEditable(active)) { leaked = e.key; leakedEl = active as HTMLElement }
          armBurstTimeout()
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

  /** WAFI-125: subscribe to raw detection events (diagnostics screen only). */
  function onDiagnostic(cb: (e: ScanDiagnosticEvent) => void) {
    diagnosticCallbacks.push(cb)
  }

  function destroy() {
    document.removeEventListener('keydown', handleKeyDown)
    callbacks = []
    diagnosticCallbacks = []
    resetBurst()
  }

  async function startCamera(videoEl: HTMLVideoElement, onResult: ScanCallback): Promise<() => void> {
    if (!cameraAvailable.value) throw new Error('Camera not available')
    const { BrowserMultiFormatReader } = await import('@zxing/browser')
    const codeReader = new BrowserMultiFormatReader()
    let fired = false
    const controls = await codeReader.decodeFromVideoDevice(undefined, videoEl, (result) => {
      if (result && !fired) {
        fired = true
        onResult(result.getText())
      }
    })
    return () => controls.stop()
  }

  return { cameraAvailable, onScan, offScan, onDiagnostic, startCamera, destroy }
}
