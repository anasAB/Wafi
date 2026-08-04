import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/services/events/logger', () => ({ logger: { error: vi.fn() } }))

import { db } from '@/data/powersync/db'
import { logger } from '@/services/events/logger'
import { processProjectionAtMostOnce, SubscriberId } from '@/services/events/processProjectionAtMostOnce'

describe('processProjectionAtMostOnce', () => {
  beforeEach(() => vi.clearAllMocks())

  it('runs the action on first insert', async () => {
    const action = vi.fn().mockResolvedValue(undefined)
    await processProjectionAtMostOnce(SubscriberId.DailyEventCounts, 'e1', action)
    expect(db.execute).toHaveBeenCalledWith(
      expect.stringContaining('insert into local_event_processed_ledger'),
      [SubscriberId.DailyEventCounts, 'e1', expect.any(String)],
    )
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('skips the action when the ledger insert rejects (already processed)', async () => {
    vi.mocked(db.execute).mockRejectedValueOnce(new Error('UNIQUE constraint failed'))
    const action = vi.fn().mockResolvedValue(undefined)
    await processProjectionAtMostOnce(SubscriberId.DailyEventCounts, 'e1', action)
    expect(action).not.toHaveBeenCalled()
  })

  it('logs (not swallows) when the action itself throws, after the ledger commit', async () => {
    const action = vi.fn().mockRejectedValue(new Error('boom'))
    await expect(
      processProjectionAtMostOnce(SubscriberId.DailyEventCounts, 'e1', action),
    ).resolves.toBeUndefined()
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('processProjectionAtMostOnce'),
      SubscriberId.DailyEventCounts, 'e1', expect.any(Error),
    )
  })

  it('runs independently per subscriber for the same eventId', async () => {
    const action1 = vi.fn().mockResolvedValue(undefined)
    const action2 = vi.fn().mockResolvedValue(undefined)
    await processProjectionAtMostOnce(SubscriberId.DailyEventCounts, 'e1', action1)
    await processProjectionAtMostOnce('another_subscriber' as any, 'e1', action2)
    expect(action1).toHaveBeenCalledTimes(1)
    expect(action2).toHaveBeenCalledTimes(1)
  })
})
