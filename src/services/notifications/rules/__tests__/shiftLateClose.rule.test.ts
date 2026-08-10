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

  it('fires for a past-midnight close (close_time 21:00, closed at 00:30 next day, before open_time 09:00)', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ close_time: '21:00', open_time: '09:00', is_24_7: 0 } as any) // shop hours lookup
      .mockResolvedValueOnce(undefined) // dedup lookup
    // Same-day anchor would compute this as ~20.5 hours EARLY (00:30 vs 21:00 the
    // same calendar day) and never fire -- the past-midnight re-anchor must kick in
    // and recognize this as ~3.5 hours (210 min) LATE instead. 00:30 is before the
    // shop's 09:00 open_time, so this is genuinely still "closed" territory.
    const event = { ...baseEvent, occurredAt: '2026-01-02T00:30:00.000Z' }
    await handleShiftLateCloseEvent(event)
    expect(db.execute).toHaveBeenCalledWith(expect.stringContaining('insert into notifications'), expect.arrayContaining(['WARNING']))
  })

  it('does not fire for a legit early-morning shift handoff close at/after open_time (close_time 21:00, open_time 09:00, closed at 09:30)', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ close_time: '21:00', open_time: '09:00', is_24_7: 0 } as any) // shop hours lookup
    // Without the open_time guard, this would falsely re-anchor to the previous
    // day's 21:00 close and compute ~12.5h "late". With the guard, 09:30 is AFTER
    // open_time (09:00), so this is a normal early close -- no re-anchor, no fire.
    const event = { ...baseEvent, occurredAt: '2026-01-02T09:30:00.000Z' }
    await handleShiftLateCloseEvent(event)
    expect(db.execute).not.toHaveBeenCalled()
  })

  it('does not apply the past-midnight re-anchor when open_time is not configured', async () => {
    vi.mocked(db.getOptional)
      .mockResolvedValueOnce({ close_time: '21:00', open_time: null, is_24_7: 0 } as any) // shop hours lookup
    // No open_time means we can't distinguish "still closed" from "normal early
    // close" -- the heuristic must not apply, so this early close does not fire.
    const event = { ...baseEvent, occurredAt: '2026-01-02T00:30:00.000Z' }
    await handleShiftLateCloseEvent(event)
    expect(db.execute).not.toHaveBeenCalled()
  })
})
