import { describe, it, expect, vi, beforeEach } from 'vitest'
import { db } from '@/data/powersync/db'
import { getNotificationSettings } from '@/services/notifications/notificationSettings'
import { handleCustomerDebtThresholdEvent } from '../customerDebtThreshold.rule'

vi.mock('@/data/powersync/db', () => ({ db: { getOptional: vi.fn(), execute: vi.fn() } }))
vi.mock('@/services/notifications/notificationSettings')

const baseEvent = {
  type: 'customer.debt_changed', eventId: 'evt1', entityId: 'c1', staffId: 's1', shopId: 'shop1',
  occurredAt: '2026-01-01T12:00:00.000Z', payloadVersion: 1,
  payload: { customerId: 'c1', deltaUsd: 100, newBalanceUsd: 700, reason: 'credit_sale' },
} as any

beforeEach(() => {
  vi.clearAllMocks() // isolate db.getOptional/db.execute call history between tests (no global resetMocks config)
  vi.mocked(getNotificationSettings).mockResolvedValue({ type: 'customer.debt_threshold', dailyDebtUsdCap: 500, enabled: true })
})

it('fires when today\'s cumulative crosses from <= cap to > cap', async () => {
  vi.mocked(db.getOptional)
    .mockResolvedValueOnce({ total: 550 } as any)  // aggregate query: today's total AFTER this event
    .mockResolvedValueOnce(undefined)              // no existing notification today
  await handleCustomerDebtThresholdEvent(baseEvent)
  // before = 550 - 100 = 450 (<= 500), after = 550 (> 500) -> fires
  expect(db.execute).toHaveBeenCalledWith(expect.stringContaining('insert into notifications'), expect.anything())
})

it('fires on a shop-wide crossing driven by other customers\' credit sales, not just this event\'s own customer', async () => {
  // customer A's earlier $300 credit sale + customer B's (this event's) $100 sale +
  // some other earlier $150 sale today = $550 shop-wide total, crosses the $500 cap --
  // even though this triggering event's own deltaUsd (100) is far short of the cap.
  vi.mocked(db.getOptional)
    .mockResolvedValueOnce({ total: 550 } as any)
    .mockResolvedValueOnce(undefined)
  await handleCustomerDebtThresholdEvent(baseEvent)
  expect(db.execute).toHaveBeenCalledWith(expect.stringContaining('insert into notifications'), expect.anything())
})

it('scopes the aggregate query shop-wide, not per-customer (pins against re-introducing a customer_id filter)', async () => {
  vi.mocked(db.getOptional)
    .mockResolvedValueOnce({ total: 550 } as any)
    .mockResolvedValueOnce(undefined)
  await handleCustomerDebtThresholdEvent(baseEvent)
  const [aggregateSql, aggregateParams] = vi.mocked(db.getOptional).mock.calls[0]
  expect(aggregateSql).not.toContain('customer_id')
  expect(aggregateParams).toEqual(['shop1', '2026-01-01'])
})

it('does not fire when already above the cap before this event (no re-crossing)', async () => {
  vi.mocked(db.getOptional).mockResolvedValueOnce({ total: 700 } as any) // before = 700-100=600, already > cap
  await handleCustomerDebtThresholdEvent(baseEvent)
  expect(db.execute).not.toHaveBeenCalled()
})

it('does not fire twice for the same day even if it crosses again (notification already exists today)', async () => {
  vi.mocked(db.getOptional)
    .mockResolvedValueOnce({ total: 550 } as any)
    .mockResolvedValueOnce({ id: 'existing' } as any) // already notified today
  await handleCustomerDebtThresholdEvent(baseEvent)
  expect(db.execute).not.toHaveBeenCalled()
})

it('ignores events that are not a credit-sale increase', async () => {
  const returnEvent = { ...baseEvent, payload: { ...baseEvent.payload, reason: 'return', deltaUsd: -50 } }
  await handleCustomerDebtThresholdEvent(returnEvent)
  expect(db.getOptional).not.toHaveBeenCalled()
  expect(db.execute).not.toHaveBeenCalled()
})

it('is replay-safe: redelivering the identical event twice inserts only one notification', async () => {
  // Both deliveries recompute the same aggregate from already-committed data (no
  // in-memory counter is incremented), so before/after are identical each time.
  // First delivery: no notification exists yet -> fires and (in reality) persists a row.
  // Second delivery of the SAME event: the aggregate is unchanged (source data didn't
  // change) and the dedup check now finds the row the first delivery inserted -> skips.
  vi.mocked(db.getOptional)
    .mockResolvedValueOnce({ total: 550 } as any) // 1st delivery: aggregate
    .mockResolvedValueOnce(undefined)             // 1st delivery: no existing notification -> fires
    .mockResolvedValueOnce({ total: 550 } as any) // 2nd delivery: same aggregate (data unchanged)
    .mockResolvedValueOnce({ id: 'existing' } as any) // 2nd delivery: dedup finds the row just inserted

  await handleCustomerDebtThresholdEvent(baseEvent)
  await handleCustomerDebtThresholdEvent(baseEvent)

  expect(db.execute).toHaveBeenCalledTimes(1)
})
