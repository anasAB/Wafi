import { describe, it, expect, vi, beforeEach } from 'vitest'
import { db } from '@/data/powersync/db'
import { getNotificationSettings } from '@/services/notifications/notificationSettings'
import { handleNewDeviceEvent } from '../newDevice.rule'

vi.mock('@/data/powersync/db', () => ({ db: { getOptional: vi.fn(), execute: vi.fn() } }))
vi.mock('@/services/notifications/notificationSettings')

const baseEvent = {
  type: 'device.registered', eventId: 'evt1', entityId: 'device1', staffId: 's1', shopId: 'shop1',
  occurredAt: '2026-01-01T00:00:00.000Z', payloadVersion: 1,
  payload: { deviceId: 'device1', deviceCode: 'DEV-001', isTemporary: false },
} as any

beforeEach(() => {
  vi.clearAllMocks()
})

it('fires when enabled', async () => {
  vi.mocked(getNotificationSettings).mockResolvedValue({ type: 'device.registered', enabled: true })
  vi.mocked(db.getOptional).mockResolvedValueOnce(undefined)
  await handleNewDeviceEvent(baseEvent)
  expect(db.execute).toHaveBeenCalledWith(expect.stringContaining('insert into notifications'), expect.arrayContaining(['INFO']))
})

it('does nothing when disabled', async () => {
  vi.mocked(getNotificationSettings).mockResolvedValue({ type: 'device.registered', enabled: false })
  await handleNewDeviceEvent({ shopId: 'shop1', payload: { deviceId: 'device1', deviceCode: 'DEV-001', isTemporary: false } } as any)
  expect(db.execute).not.toHaveBeenCalled()
})

it('does nothing when a notification for this event already exists (dedup)', async () => {
  vi.mocked(getNotificationSettings).mockResolvedValue({ type: 'device.registered', enabled: true })
  vi.mocked(db.getOptional).mockResolvedValueOnce({ id: 'existing-notif' } as any)
  await handleNewDeviceEvent(baseEvent)
  expect(db.execute).not.toHaveBeenCalled()
})
