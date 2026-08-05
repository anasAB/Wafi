import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { db } from '@/data/powersync/db'
import { cleanupLocalEventTables, startEventTableCleanupSweeper } from '@/services/events/cleanupLocalEventTables'

describe('cleanupLocalEventTables', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes ledger rows whose event_id no longer exists in events', async () => {
    await cleanupLocalEventTables()
    const call = vi.mocked(db.execute).mock.calls.find(([sql]) => sql.includes('local_event_processed_ledger'))
    expect(call).toBeDefined()
    expect(call![0]).toContain('not exists')
    expect(call![0]).not.toContain('not in')
  })

  it('deletes only permanent retry rows older than 90 days, leaves transient rows untouched', async () => {
    await cleanupLocalEventTables()
    const call = vi.mocked(db.execute).mock.calls.find(([sql]) => sql.includes('local_event_publish_retries'))
    expect(call).toBeDefined()
    expect(call![0]).toContain(`failure_kind = 'permanent'`)
  })
})

describe('startEventTableCleanupSweeper', () => {
  beforeEach(() => vi.clearAllMocks())

  it('runs cleanup once on start and again on every reconnect transition', () => {
    let capturedListener: any
    vi.mocked(db.registerListener).mockImplementation((listener: any) => {
      capturedListener = listener
      return () => {}
    })
    startEventTableCleanupSweeper()
    expect(db.execute).toHaveBeenCalled() // the initial run
    vi.clearAllMocks()
    capturedListener.statusChanged({ connected: true })
    expect(db.execute).toHaveBeenCalled() // the reconnect-triggered run
  })

  it('stop() unsubscribes the reconnect listener', () => {
    const unsubscribe = vi.fn()
    vi.mocked(db.registerListener).mockReturnValue(unsubscribe)
    const { stop } = startEventTableCleanupSweeper()
    stop()
    expect(unsubscribe).toHaveBeenCalled()
  })
})
