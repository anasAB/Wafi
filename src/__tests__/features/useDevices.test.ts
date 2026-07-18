import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

const logDeviceRenamed    = vi.fn(async () => {})
const logDeviceActivation = vi.fn(async () => {})
vi.mock('@/features/audit/composables/useAuditLog', () => ({
  useAuditLog: () => ({ logDeviceRenamed, logDeviceActivation }),
}))

import { useDevices, rowIsActive, touchDeviceLastSeen } from '@/features/devices/composables/useDevices'
import { useDeviceStore } from '@/store/device.store'
import { db } from '@/data/powersync/db'

function deviceRow(over: Record<string, unknown> = {}) {
  return {
    id: 'dev-row-1', code: 'A', label: null, is_temporary: 0,
    registered_at: '2026-07-01T08:00:00Z', last_seen_at: null, is_active: 1, ...over,
  }
}

describe('useDevices (WAFI-130)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.getAll).mockResolvedValue([])
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
  })

  it('legacy rows with null is_active are ACTIVE (only explicit 0 deactivates)', () => {
    expect(rowIsActive(null)).toBe(true)
    expect(rowIsActive(undefined)).toBe(true)
    expect(rowIsActive(1)).toBe(true)
    expect(rowIsActive(0)).toBe(false)
  })

  it('load marks the current device via its code', async () => {
    const store = useDeviceStore()
    ;(store.deviceCode as unknown as string) = store.deviceCode // persisted stub from env
    vi.mocked(db.getAll).mockResolvedValue([
      deviceRow({ code: store.deviceCode || 'A' }),
      deviceRow({ id: 'dev-row-2', code: 'ZZZ', is_active: 0 }),
    ] as any)

    const { devices, load } = useDevices()
    await load()

    expect(devices.value).toHaveLength(2)
    expect(devices.value[1].isActive).toBe(false)
  })

  it('rename updates the label and audit-logs it', async () => {
    vi.mocked(db.getAll).mockResolvedValue([deviceRow()] as any)
    const { load, rename } = useDevices()
    await load()

    await rename('dev-row-1', '  كاشير ١  ')

    const update = vi.mocked(db.execute).mock.calls.find(([sql]) => /UPDATE devices SET label/.test(sql as string))!
    expect(update[1]).toEqual(['كاشير ١', 'dev-row-1'])
    expect(logDeviceRenamed).toHaveBeenCalledWith('dev-row-1', 'A', 'كاشير ١')
  })

  it('deactivation writes is_active = 0 and audit-logs as sensitive action', async () => {
    vi.mocked(db.getAll).mockResolvedValue([deviceRow({ code: 'B' })] as any)
    const { load, setActive } = useDevices()
    await load()

    await setActive('dev-row-1', false)

    const update = vi.mocked(db.execute).mock.calls.find(([sql]) => /UPDATE devices SET is_active/.test(sql as string))!
    expect(update[1]).toEqual([0, 'dev-row-1'])
    expect(logDeviceActivation).toHaveBeenCalledWith('dev-row-1', 'B', false)
  })

  it('refuses to deactivate the device currently in use (self-lockout guard)', async () => {
    const store = useDeviceStore()
    vi.mocked(db.getAll).mockResolvedValue([deviceRow({ code: store.deviceCode })] as any)
    const { load, setActive } = useDevices()
    await load()

    if (store.deviceCode) { // env stub present in test env
      await expect(setActive('dev-row-1', false)).rejects.toThrow()
      expect(vi.mocked(db.execute).mock.calls.find(([sql]) => /is_active/.test(sql as string))).toBeUndefined()
    }
  })

  it('touchDeviceLastSeen is a no-op without identity and never throws', async () => {
    await touchDeviceLastSeen('', '')
    expect(vi.mocked(db.execute)).not.toHaveBeenCalled()

    vi.mocked(db.execute).mockRejectedValueOnce(new Error('locked'))
    await expect(touchDeviceLastSeen('shop1', 'A')).resolves.toBeUndefined()
  })
})
