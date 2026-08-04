import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/services/events/publishEvent', () => ({ publishEvent: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/store/session.store', () => ({
  useSessionStore: () => ({ activeStaff: { role: 'owner' } }),
}))

import { publishEvent } from '@/services/events/publishEvent'
import { executeBusinessOperation } from '@/composables/executeBusinessOperation'

describe('executeBusinessOperation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does not call publishEvent when toEvent returns undefined', async () => {
    const result = await executeBusinessOperation(
      async () => ({ changed: false }),
      {
        audit: async () => {},
        toEvent: () => undefined,
      },
    )
    expect(result).toEqual({ changed: false })
    expect(publishEvent).not.toHaveBeenCalled()
  })

  it('still calls publishEvent when toEvent returns a DomainEvent', async () => {
    await executeBusinessOperation(
      async () => ({ changed: true }),
      {
        audit: async () => {},
        toEvent: () => ({
          type: 'expense.recorded', entityId: 'e1', payload: {}, payloadVersion: 1,
          staffId: 's1', shopId: 'shop1', occurredAt: '2026-08-03T00:00:00.000Z',
        }),
      },
    )
    expect(publishEvent).toHaveBeenCalledTimes(1)
  })
})
