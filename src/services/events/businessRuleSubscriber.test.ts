import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRunDurableSubscriber = vi.fn()
vi.mock('./runDurableSubscriber', () => ({ runDurableSubscriber: (opts: unknown) => mockRunDurableSubscriber(opts) }))

const mockLoadEnabledRules = vi.fn()
vi.mock('./loadEnabledRules', () => ({ loadEnabledRules: (...args: unknown[]) => mockLoadEnabledRules(...args) }))

const mockRpc = vi.fn()
vi.mock('@/data/supabase/client', () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args) } }))

import { startBusinessRuleSubscribers, DATA_DRIVEN_RULE_EVENT_TYPES } from './businessRuleSubscriber'

describe('DATA_DRIVEN_RULE_EVENT_TYPES', () => {
  it('lists exactly the two supported event types', () => {
    expect(DATA_DRIVEN_RULE_EVENT_TYPES).toEqual(['sale.returned', 'shift.closed'])
  })
})

describe('startBusinessRuleSubscribers', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('registers one fixed subscriber per supported event type, unconditionally', () => {
    startBusinessRuleSubscribers('shop1')
    expect(mockRunDurableSubscriber).toHaveBeenCalledTimes(2)
    expect(mockRunDurableSubscriber).toHaveBeenCalledWith(
      expect.objectContaining({ subscriberName: 'business-rules:sale.returned', eventType: 'sale.returned', shopId: 'shop1' }),
    )
    expect(mockRunDurableSubscriber).toHaveBeenCalledWith(
      expect.objectContaining({ subscriberName: 'business-rules:shift.closed', eventType: 'shift.closed', shopId: 'shop1' }),
    )
  })

  it('the sale.returned handler loads every enabled rule and calls execute_rule_action for each, unconditionally', async () => {
    mockLoadEnabledRules.mockResolvedValue([
      { id: 'rule-a', ruleKey: 'large_return' }, { id: 'rule-b', ruleKey: 'other' },
    ])
    mockRpc.mockResolvedValue({ data: 'executed', error: null })

    startBusinessRuleSubscribers('shop1')
    const saleReturnedCall = mockRunDurableSubscriber.mock.calls.find(
      ([opts]) => opts.eventType === 'sale.returned',
    )
    const handler = saleReturnedCall![0].handler
    const event = { eventId: 'e1', shopId: 'shop1', type: 'sale.returned', payload: {}, entityId: 'x', payloadVersion: 1, staffId: null, occurredAt: '' }

    await handler(event)

    expect(mockLoadEnabledRules).toHaveBeenCalledWith('shop1', 'sale.returned')
    // Called once per loaded rule, regardless of any condition -- there is no
    // local filter to suppress a call, per this task's correction above.
    expect(mockRpc).toHaveBeenCalledTimes(2)
    expect(mockRpc).toHaveBeenCalledWith('execute_rule_action', { p_event_id: 'e1', p_rule_id: 'rule-a' })
    expect(mockRpc).toHaveBeenCalledWith('execute_rule_action', { p_event_id: 'e1', p_rule_id: 'rule-b' })
  })

  it('one rule RPC failure still lets sibling rule calls proceed independently', async () => {
    mockLoadEnabledRules.mockResolvedValue([
      { id: 'rule-a', ruleKey: 'large_return' }, { id: 'rule-b', ruleKey: 'other' },
    ])
    mockRpc
      .mockResolvedValueOnce({ data: null, error: new Error('boom') })
      .mockResolvedValueOnce({ data: 'executed', error: null })

    startBusinessRuleSubscribers('shop1')
    const saleReturnedCall = mockRunDurableSubscriber.mock.calls.find(
      ([opts]) => opts.eventType === 'sale.returned',
    )
    const handler = saleReturnedCall![0].handler
    const event = { eventId: 'e1', shopId: 'shop1', type: 'sale.returned', payload: {}, entityId: 'x', payloadVersion: 1, staffId: null, occurredAt: '' }

    // The whole handler call is allowed to reject (runDurableSubscriber's own
    // catch/retry-queue wraps it) -- but both rules must have been attempted.
    await handler(event).catch(() => {})

    expect(mockRpc).toHaveBeenCalledTimes(2)
  })
})
