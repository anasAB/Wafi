import { describe, it, expect, vi, beforeEach } from 'vitest'
import { db } from '@/data/powersync/db'
import { getNotificationSettings } from '@/services/notifications/notificationSettings'
import { handleDrawerVarianceEvent } from '../drawerVariance.rule'

vi.mock('@/data/powersync/db', () => ({ db: { getOptional: vi.fn(), execute: vi.fn() } }))
vi.mock('@/services/notifications/notificationSettings')

const baseEvent = {
  type: 'shift.closed', eventId: 'evt1', entityId: 'shift1', staffId: 's1', shopId: 'shop1',
  occurredAt: '2026-01-01T21:00:00.000Z', payloadVersion: 1,
} as any

beforeEach(() => {
  vi.clearAllMocks() // isolate db.execute call history between tests (no global resetMocks config)
  vi.mocked(db.getOptional).mockResolvedValue(undefined) // no existing dedup row
  vi.mocked(getNotificationSettings).mockResolvedValue({ type: 'drawer.variance', varianceUsdCap: 15, enabled: true })
})

describe('handleDrawerVarianceEvent', () => {
  it('inserts a CRITICAL notification when |variance| exceeds the cap', async () => {
    const event = { ...baseEvent, payload: { shiftId: 'shift1', staffId: 's1', expectedCash: 100, countedCash: 80, variance: -20 } }
    await handleDrawerVarianceEvent(event)
    expect(db.execute).toHaveBeenCalledWith(expect.stringContaining('insert into notifications'), expect.arrayContaining(['CRITICAL']))
  })

  it('does not insert when |variance| is within the cap', async () => {
    const event = { ...baseEvent, payload: { shiftId: 'shift1', staffId: 's1', expectedCash: 100, countedCash: 95, variance: -5 } }
    await handleDrawerVarianceEvent(event)
    expect(db.execute).not.toHaveBeenCalled()
  })

  it('does nothing when the rule is disabled', async () => {
    vi.mocked(getNotificationSettings).mockResolvedValue({ type: 'drawer.variance', varianceUsdCap: 15, enabled: false })
    const event = { ...baseEvent, payload: { shiftId: 'shift1', staffId: 's1', expectedCash: 100, countedCash: 50, variance: -50 } }
    await handleDrawerVarianceEvent(event)
    expect(db.execute).not.toHaveBeenCalled()
  })
})
