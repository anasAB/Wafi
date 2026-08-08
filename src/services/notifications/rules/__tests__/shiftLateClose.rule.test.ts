import { describe, it, expect, vi, beforeEach } from 'vitest'
import { db } from '@/data/powersync/db'
import { getNotificationSettings } from '@/services/notifications/notificationSettings'
import { handleShiftLateCloseEvent } from '../shiftLateClose.rule'

vi.mock('@/data/powersync/db', () => ({ db: { getOptional: vi.fn(), execute: vi.fn() } }))
vi.mock('@/services/notifications/notificationSettings')

const baseEvent = {
  type: 'shift.closed', eventId: 'evt1', entityId: 'shift1', staffId: 's1', shopId: 'shop1',
  payloadVersion: 1, payload: { shiftId: 'shift1', staffId: 's1', expectedCash: 0, countedCash: 0, variance: 0 },
} as any

beforeEach(() => {
  vi.clearAllMocks() // isolate db.execute call history and getOptional queues between tests
  vi.mocked(getNotificationSettings).mockResolvedValue({ type: 'shift.late_close', graceMinutes: 15, enabled: true })
})

describe('handleShiftLateCloseEvent', () => {
  it('fires when closed after close_time + grace', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ close_time: '21:00', is_24_7: 0 } as any) // shop hours lookup
      .mockResolvedValueOnce(undefined) // dedup lookup
    const event = { ...baseEvent, occurredAt: '2026-01-01T21:20:00.000Z' } // 20 min late, grace is 15
    await handleShiftLateCloseEvent(event)
    expect(db.execute).toHaveBeenCalledWith(expect.stringContaining('insert into notifications'), expect.arrayContaining(['WARNING']))
  })

  it('does not fire within the grace window', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({ close_time: '21:00', is_24_7: 0 } as any)
    const event = { ...baseEvent, occurredAt: '2026-01-01T21:10:00.000Z' } // 10 min late, grace is 15
    await handleShiftLateCloseEvent(event)
    expect(db.execute).not.toHaveBeenCalled()
  })

  it('does not fire when the shop has no close_time configured', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({ close_time: null, is_24_7: 0 } as any)
    const event = { ...baseEvent, occurredAt: '2026-01-01T23:59:00.000Z' }
    await handleShiftLateCloseEvent(event)
    expect(db.execute).not.toHaveBeenCalled()
  })
})
