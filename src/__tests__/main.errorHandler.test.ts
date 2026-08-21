import { describe, it, expect, vi, beforeEach } from 'vitest'

// main.ts is the app entrypoint: it has import-time side effects (router,
// i18n, App.vue, PrimeVue, mounting to '#app') that are unrelated to what
// WAFI-148 adds. Every real dependency is stubbed here so importing main.ts
// is safe in a test, and 'vue' is partially mocked so we can capture the
// actual `app` instance createApp() returns (main.ts never exports it) to
// inspect app.config.errorHandler after import.
let capturedApp: any
vi.mock('vue', async () => {
  const actual = await vi.importActual<typeof import('vue')>('vue')
  return {
    ...actual,
    createApp: (...args: any[]) => {
      capturedApp = (actual.createApp as any)(...args)
      // Prevent the real .mount('#app') from throwing/rendering by stubbing
      // it to a no-op that still returns the app for chaining.
      capturedApp.mount = vi.fn().mockReturnValue(capturedApp)
      return capturedApp
    },
  }
})

vi.mock('pinia', async () => {
  const actual = await vi.importActual<typeof import('pinia')>('pinia')
  return actual
})
vi.mock('pinia-plugin-persistedstate', () => ({ default: () => () => {} }))
vi.mock('primevue/config', () => ({ default: { install: () => {} } }))
vi.mock('@primeuix/themes/aura', () => ({ default: {} }))
vi.mock('../i18n', () => ({ i18n: { install: () => {} } }))
vi.mock('../style.css', () => ({}))
vi.mock('primeicons/primeicons.css', () => ({}))
vi.mock('../App.vue', () => ({ default: { render: () => null } }))
vi.mock('../router', () => ({ default: { install: () => {} } }))
vi.mock('../sentry', () => ({ initSentry: vi.fn() }))
vi.mock('../router/bootstrap-resume', () => ({ resumeBootstrapIfPending: vi.fn().mockResolvedValue(undefined) }))

const incrementLocalHealthCounter = vi.fn(async () => {})
vi.mock('../data/powersync/healthCounters', () => ({
  incrementLocalHealthCounter: (...a: any[]) => incrementLocalHealthCounter(...a),
  getShopLocalToday: async () => '2026-08-21',
}))
// deviceId deliberately left empty: startHealthReporting's getContext (a
// separate concern from the error handler under test here) requires both
// shopId AND deviceId to attempt a tick, so leaving it unset keeps that
// machinery (real db/supabase, unmocked here) from ever running.
vi.mock('../store/device.store', () => ({
  useDeviceStore: () => ({ shopId: 'shop-1', deviceId: '', refreshShopId: vi.fn() }),
}))

describe('main.ts global error handler (WAFI-148)', () => {
  beforeEach(() => {
    vi.resetModules()
    incrementLocalHealthCounter.mockClear()
    capturedApp = undefined
  })

  it('counts app_error_count on an unhandled Vue error, independent of Sentry configuration', async () => {
    await import('../main')
    expect(capturedApp).toBeDefined()

    const err = new Error('boom')
    capturedApp.config.errorHandler(err, null, 'render function')

    // The handler resolves the shop's timezone asynchronously (fire-and-forget)
    // before incrementing -- await that instead of asserting synchronously.
    await vi.waitFor(() => {
      expect(incrementLocalHealthCounter).toHaveBeenCalledExactlyOnceWith('app_error_count', '2026-08-21')
    })
  })

  it('still forwards to a previously-installed handler (e.g. Sentry) rather than replacing it', async () => {
    const previousHandler = vi.fn()
    vi.doMock('vue', async () => {
      const actual = await vi.importActual<typeof import('vue')>('vue')
      return {
        ...actual,
        createApp: (...args: any[]) => {
          capturedApp = (actual.createApp as any)(...args)
          capturedApp.config.errorHandler = previousHandler
          capturedApp.mount = vi.fn().mockReturnValue(capturedApp)
          return capturedApp
        },
      }
    })

    await import('../main')
    const err = new Error('boom')
    capturedApp.config.errorHandler(err, null, 'render function')

    await vi.waitFor(() => {
      expect(incrementLocalHealthCounter).toHaveBeenCalledExactlyOnceWith('app_error_count', '2026-08-21')
    })
    expect(previousHandler).toHaveBeenCalledExactlyOnceWith(err, null, 'render function')
  })
})
