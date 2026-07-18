import { ref, computed, watch } from 'vue'

/**
 * WAFI-124: which one-tap exact-cash buttons show on the cart and their order.
 * Device-local (localStorage) like other personal preferences — shops differ in
 * dominant currency, and the setting is a UI arrangement, not financial data.
 * Default: both shown, SYP first (the dominant tender).
 */
export interface FastCashSettings {
  showSyp:  boolean
  showUsd:  boolean
  sypFirst: boolean
}

const STORAGE_KEY = 'wafi.fastCashSettings'
const DEFAULTS: FastCashSettings = { showSyp: true, showUsd: true, sypFirst: true }

function read(): FastCashSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULTS }
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<FastCashSettings>) }
  } catch {
    return { ...DEFAULTS }
  }
}

export function useFastCashSettings() {
  const settings = ref<FastCashSettings>(read())

  watch(settings, (v) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(v)) } catch { /* storage full/blocked: keep in-memory */ }
  }, { deep: true })

  /** Currencies to render as fast buttons, in display order. */
  const fastButtons = computed<Array<'SYP' | 'USD'>>(() => {
    const order: Array<'SYP' | 'USD'> = settings.value.sypFirst ? ['SYP', 'USD'] : ['USD', 'SYP']
    return order.filter(c => (c === 'SYP' ? settings.value.showSyp : settings.value.showUsd))
  })

  return { settings, fastButtons }
}
