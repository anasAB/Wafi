import { describe, it, expect, vi, beforeEach } from 'vitest'
import { db } from '@/data/powersync/db'
import { getNotificationSettings } from '@/services/notifications/notificationSettings'
import { handleAfterHoursExpenseEvent } from '../afterHoursExpense.rule'

vi.mock('@/data/powersync/db', () => ({ db: { getOptional: vi.fn(), execute: vi.fn() } }))
vi.mock('@/services/notifications/notificationSettings')

const baseEvent = {
  type: 'expense.recorded', eventId: 'evt1', entityId: 'exp1', staffId: 's1', shopId: 'shop1',
  payloadVersion: 1, payload: { expenseId: 'exp1', category: 'rent', amountUsd: 50, staffId: 's1', photoUrl: undefined },
} as any

beforeEach(() => {
  vi.clearAllMocks() // isolate db.execute call history and getOptional queues between tests
  vi.mocked(getNotificationSettings).mockResolvedValue({ type: 'expense.after_hours', enabled: true })
})

it('fires when the expense occurs outside business hours', async () => {
  vi.mocked(db.getOptional)
    .mockResolvedValueOnce({ open_time: '09:00', close_time: '21:00', is_24_7: 0 } as any)
    .mockResolvedValueOnce(undefined)
  const event = { ...baseEvent, occurredAt: '2026-01-01T23:30:00.000Z' }
  await handleAfterHoursExpenseEvent(event)
  expect(db.execute).toHaveBeenCalled()
})

it('does not fire during business hours', async () => {
  vi.mocked(db.getOptional).mockResolvedValueOnce({ open_time: '09:00', close_time: '21:00', is_24_7: 0 } as any)
  const event = { ...baseEvent, occurredAt: '2026-01-01T12:00:00.000Z' }
  await handleAfterHoursExpenseEvent(event)
  expect(db.execute).not.toHaveBeenCalled()
})

it('does not fire when the shop is 24/7', async () => {
  vi.mocked(db.getOptional).mockResolvedValueOnce({ open_time: null, close_time: null, is_24_7: 1 } as any)
  const event = { ...baseEvent, occurredAt: '2026-01-01T23:30:00.000Z' }
  await handleAfterHoursExpenseEvent(event)
  expect(db.execute).not.toHaveBeenCalled()
})
