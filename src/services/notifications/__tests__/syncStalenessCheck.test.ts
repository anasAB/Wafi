import { describe, it, expect, vi, beforeEach } from 'vitest'
import { db } from '@/data/powersync/db'
import { getNotificationSettings } from '@/services/notifications/notificationSettings'
import { checkDeviceSyncStaleness } from '../syncStalenessCheck'

vi.mock('@/data/powersync/db', () => ({ db: { getAll: vi.fn(), getOptional: vi.fn(), execute: vi.fn() } }))
vi.mock('@/services/notifications/notificationSettings')

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getNotificationSettings).mockResolvedValue({ type: 'device.sync_stale', staleHours: 2, enabled: true })
  vi.setSystemTime(new Date('2026-01-01T12:00:00.000Z'))
})

describe('checkDeviceSyncStaleness', () => {
  it('excludes the current device from staleness checks', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      { id: 'this-device', last_seen_at: '2026-01-01T00:00:00.000Z' }, // 12h stale, but IS the current device
    ] as any)
    await checkDeviceSyncStaleness('shop1', 'this-device')
    expect(db.execute).not.toHaveBeenCalled()
  })

  it('fires for a genuinely stale OTHER device', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      { id: 'other-device', last_seen_at: '2026-01-01T00:00:00.000Z' }, // 12h stale
    ] as any)
    vi.mocked(db.getOptional).mockResolvedValue(undefined) // not already notified for this episode
    await checkDeviceSyncStaleness('shop1', 'this-device')
    expect(db.execute).toHaveBeenCalledWith(expect.stringContaining('insert into notifications'), expect.anything())
  })

  it('does not fire for a device seen recently', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      { id: 'other-device', last_seen_at: '2026-01-01T11:30:00.000Z' }, // 30 min ago
    ] as any)
    await checkDeviceSyncStaleness('shop1', 'this-device')
    expect(db.execute).not.toHaveBeenCalled()
  })

  it('does not fire when the setting is disabled', async () => {
    vi.mocked(getNotificationSettings).mockResolvedValue({ type: 'device.sync_stale', staleHours: 2, enabled: false })
    vi.mocked(db.getAll).mockResolvedValue([
      { id: 'other-device', last_seen_at: '2026-01-01T00:00:00.000Z' },
    ] as any)
    await checkDeviceSyncStaleness('shop1', 'this-device')
    expect(db.getAll).not.toHaveBeenCalled()
    expect(db.execute).not.toHaveBeenCalled()
  })

  it('does not re-fire when already notified today for this device (dedup)', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      { id: 'other-device', last_seen_at: '2026-01-01T00:00:00.000Z' },
    ] as any)
    vi.mocked(db.getOptional).mockResolvedValue({ id: 'existing-notification' } as any)
    await checkDeviceSyncStaleness('shop1', 'this-device')
    expect(db.execute).not.toHaveBeenCalled()
  })

  it('fires independently for multiple stale devices', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      { id: 'device-a', last_seen_at: '2026-01-01T00:00:00.000Z' },
      { id: 'device-b', last_seen_at: '2026-01-01T01:00:00.000Z' },
    ] as any)
    vi.mocked(db.getOptional).mockResolvedValue(undefined)
    await checkDeviceSyncStaleness('shop1', 'this-device')
    expect(db.execute).toHaveBeenCalledTimes(2)
    const calls = vi.mocked(db.execute).mock.calls
    expect(calls[0][1]).toEqual(expect.arrayContaining(['device-a']))
    expect(calls[1][1]).toEqual(expect.arrayContaining(['device-b']))
  })

  it('does not query inactive (is_active = 0) devices -- filtered at the SQL level', async () => {
    vi.mocked(db.getAll).mockResolvedValue([])
    await checkDeviceSyncStaleness('shop1', 'this-device')
    expect(db.getAll).toHaveBeenCalledWith(
      expect.stringContaining('is_active is null or is_active = 1'),
      ['shop1'],
    )
    expect(db.execute).not.toHaveBeenCalled()
  })

  it('skips a device with no last_seen_at recorded yet', async () => {
    vi.mocked(db.getAll).mockResolvedValue([
      { id: 'other-device', last_seen_at: null },
    ] as any)
    await checkDeviceSyncStaleness('shop1', 'this-device')
    expect(db.execute).not.toHaveBeenCalled()
  })
})
