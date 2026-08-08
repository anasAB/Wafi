import { describe, it, expect, vi, beforeEach } from 'vitest'
import { db } from '@/data/powersync/db'
import { getNotificationSettings } from '@/services/notifications/notificationSettings'
import { handleLargeReturnEvent } from '../largeReturn.rule'

vi.mock('@/data/powersync/db', () => ({ db: { getOptional: vi.fn(), execute: vi.fn() } }))
vi.mock('@/services/notifications/notificationSettings')

const baseEvent = {
  type: 'sale.returned', eventId: 'evt1', entityId: 'return1', staffId: 's1', shopId: 'shop1',
  occurredAt: '2026-01-01T12:00:00.000Z', payloadVersion: 1,
} as any

beforeEach(() => {
  vi.clearAllMocks() // isolate db.execute call history between tests
  vi.mocked(getNotificationSettings).mockResolvedValue({ type: 'sale.large_return', refundUsdCap: 100, enabled: true })
})

it('fires when the refund exceeds the cap', async () => {
  vi.mocked(db.getOptional).mockResolvedValueOnce(undefined)
  const event = { ...baseEvent, payload: { returnId: 'return1', saleId: 'sale1', refundAmountUsd: 150, restockedItemCount: 2 } }
  await handleLargeReturnEvent(event)
  expect(db.execute).toHaveBeenCalled()
})

it('does not fire when the refund is within the cap', async () => {
  const event = { ...baseEvent, payload: { returnId: 'return1', saleId: 'sale1', refundAmountUsd: 40, restockedItemCount: 1 } }
  await handleLargeReturnEvent(event)
  expect(db.execute).not.toHaveBeenCalled()
})

it('does not fire when a notification with this source_event_id already exists', async () => {
  vi.mocked(db.getOptional).mockResolvedValueOnce({ id: 'existing-notif' } as any)
  const event = { ...baseEvent, payload: { returnId: 'return1', saleId: 'sale1', refundAmountUsd: 150, restockedItemCount: 2 } }
  await handleLargeReturnEvent(event)
  expect(db.execute).not.toHaveBeenCalled()
})
