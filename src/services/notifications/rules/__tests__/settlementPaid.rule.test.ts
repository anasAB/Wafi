import { describe, it, expect, vi, beforeEach } from 'vitest'
import { db } from '@/data/powersync/db'
import { getNotificationSettings } from '@/services/notifications/notificationSettings'
import { handleSettlementPaidEvent } from '../settlementPaid.rule'

vi.mock('@/data/powersync/db', () => ({ db: { getOptional: vi.fn(), execute: vi.fn() } }))
vi.mock('@/services/notifications/notificationSettings')

const baseEvent = {
  type: 'settlement.paid', eventId: 'evt1', entityId: 's1', staffId: 's1', shopId: 'shop1',
  occurredAt: '2026-01-01T00:00:00.000Z', payloadVersion: 1,
  payload: { staffId: 's1', amount: 100, ledgerBalanceAfter: 0 },
} as any

beforeEach(() => {
  vi.clearAllMocks()
})

it('fires when enabled', async () => {
  vi.mocked(getNotificationSettings).mockResolvedValue({ type: 'settlement.paid', enabled: true })
  vi.mocked(db.getOptional).mockResolvedValueOnce(undefined)
  await handleSettlementPaidEvent(baseEvent)
  expect(db.execute).toHaveBeenCalledWith(expect.stringContaining('insert into notifications'), expect.arrayContaining(['INFO']))
})

it('does nothing when disabled', async () => {
  vi.mocked(getNotificationSettings).mockResolvedValue({ type: 'settlement.paid', enabled: false })
  await handleSettlementPaidEvent({ shopId: 'shop1', payload: { staffId: 's1', amount: 100, ledgerBalanceAfter: 0 } } as any)
  expect(db.execute).not.toHaveBeenCalled()
})

it('does nothing when a notification for this event already exists (dedup)', async () => {
  vi.mocked(getNotificationSettings).mockResolvedValue({ type: 'settlement.paid', enabled: true })
  vi.mocked(db.getOptional).mockResolvedValueOnce({ id: 'existing-notif' } as any)
  await handleSettlementPaidEvent(baseEvent)
  expect(db.execute).not.toHaveBeenCalled()
})
