import { describe, it, expect, vi, beforeEach } from 'vitest'

const captured: { onOfflineReady?: () => void; onNeedRefresh?: () => void } = {}
const updateSpy = vi.fn()

vi.mock('virtual:pwa-register', () => ({
  registerSW: (opts: any) => {
    captured.onOfflineReady = opts.onOfflineReady
    captured.onNeedRefresh  = opts.onNeedRefresh
    return updateSpy
  },
}))

import { usePwaLifecycle } from '@/composables/usePwaLifecycle'

beforeEach(() => {
  updateSpy.mockClear()
  captured.onOfflineReady = undefined
  captured.onNeedRefresh = undefined
})

describe('usePwaLifecycle', () => {
  it('flips offlineReady when the SW reports offline-ready', () => {
    const api = usePwaLifecycle()
    expect(api.offlineReady.value).toBe(false)
    captured.onOfflineReady?.()
    expect(api.offlineReady.value).toBe(true)
    api.dismissOfflineReady()
    expect(api.offlineReady.value).toBe(false)
  })

  it('flips needRefresh and applyUpdate triggers a reloading update', () => {
    const api = usePwaLifecycle()
    captured.onNeedRefresh?.()
    expect(api.needRefresh.value).toBe(true)
    api.applyUpdate()
    expect(updateSpy).toHaveBeenCalledWith(true)
  })
})
