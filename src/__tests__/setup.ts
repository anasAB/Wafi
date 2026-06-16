import 'fake-indexeddb/auto'
import { vi } from 'vitest'
import { config } from '@vue/test-utils'
import { i18n } from '@/i18n'

// Register the real i18n instance for every mount, mirroring the running app
// so components that call useI18n() (e.g. forms using shared validation strings)
// mount without per-test plugin wiring.
config.global.plugins = [...(config.global.plugins ?? []), i18n]

// Stub localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value },
    removeItem: (key: string) => { delete store[key] },
    clear: () => { store = {} },
  }
})()
Object.defineProperty(window, 'localStorage', { value: localStorageMock })

// Stub matchMedia (not in jsdom)
Object.defineProperty(window, 'matchMedia', {
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    onchange: null,
    dispatchEvent: vi.fn(),
  })),
})
