import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

describe('useBootstrapStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('starts with no pending bootstrap', async () => {
    const { useBootstrapStore } = await import('@/features/staff/bootstrap.store')
    expect(useBootstrapStore().pending).toBeNull()
  })

  it('start() records deviceId/staffId/createdAt with attemptCount 0', async () => {
    const { useBootstrapStore } = await import('@/features/staff/bootstrap.store')
    const store = useBootstrapStore()

    store.start('device-1', 'staff-1')

    expect(store.pending).toMatchObject({
      deviceId: 'device-1',
      staffId: 'staff-1',
      attemptCount: 0,
    })
    expect(typeof store.pending?.createdAt).toBe('string')
  })

  it('recordAttempt() increments attemptCount without changing ids', async () => {
    const { useBootstrapStore } = await import('@/features/staff/bootstrap.store')
    const store = useBootstrapStore()
    store.start('device-1', 'staff-1')

    store.recordAttempt()
    store.recordAttempt()

    expect(store.pending?.attemptCount).toBe(2)
    expect(store.pending?.deviceId).toBe('device-1')
  })

  it('clear() resets pending to null', async () => {
    const { useBootstrapStore } = await import('@/features/staff/bootstrap.store')
    const store = useBootstrapStore()
    store.start('device-1', 'staff-1')

    store.clear()

    expect(store.pending).toBeNull()
  })

  it('recordAttempt() is a no-op (does not throw) when there is no pending record', async () => {
    const { useBootstrapStore } = await import('@/features/staff/bootstrap.store')
    const store = useBootstrapStore()

    expect(() => store.recordAttempt()).not.toThrow()
    expect(store.pending).toBeNull()
  })
})
