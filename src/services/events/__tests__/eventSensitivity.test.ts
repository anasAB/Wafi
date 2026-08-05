import { describe, it, expect } from 'vitest'
import { EVENT_SENSITIVITY } from '@/services/events/domainEvent.types'

describe('EVENT_SENSITIVITY', () => {
  it('classifies the 4 known-sensitive event types per the design spec (§3)', () => {
    expect(EVENT_SENSITIVITY['staff.ledger_entry_added']).toBe('can_view_staff_ledger')
    expect(EVENT_SENSITIVITY['settlement.paid']).toBe('can_view_staff_ledger')
    expect(EVENT_SENSITIVITY['expense.recorded']).toBe('can_view_expenses')
    expect(EVENT_SENSITIVITY['product.cost_updated']).toBe('can_view_reports')
  })

  it('classifies every other wired event type as public', () => {
    const sensitiveTypes = new Set([
      'staff.ledger_entry_added', 'settlement.paid', 'expense.recorded', 'product.cost_updated',
    ])
    for (const [type, sensitivity] of Object.entries(EVENT_SENSITIVITY)) {
      if (!sensitiveTypes.has(type)) expect(sensitivity).toBe('public')
    }
  })

  it('has exactly 17 entries (one per wired DomainEventType, no stragglers)', () => {
    expect(Object.keys(EVENT_SENSITIVITY)).toHaveLength(17)
  })
})
