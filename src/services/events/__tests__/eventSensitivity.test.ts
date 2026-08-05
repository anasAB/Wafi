import { describe, it, expect } from 'vitest'
import { EVENT_SENSITIVITY } from '@/services/events/domainEvent.types'

describe('EVENT_SENSITIVITY', () => {
  it('classifies the 4 known-sensitive event types per the design spec (§3)', () => {
    expect(EVENT_SENSITIVITY['staff.ledger_entry_added']).toBe('can_view_staff_ledger')
    expect(EVENT_SENSITIVITY['settlement.paid']).toBe('can_view_staff_ledger')
    expect(EVENT_SENSITIVITY['expense.recorded']).toBe('can_view_expenses')
    expect(EVENT_SENSITIVITY['product.cost_updated']).toBe('can_view_reports')
  })

  // Replaces the previous `toHaveLength(17)` + hardcoded-Set pair (WAFI-140 Sprint 3 final
  // review): those could both be satisfied by mechanically bumping 17 -> 18 and adding the
  // new type to the local Set, so nothing forced a reviewer to consider whether
  // 077_events_per_type_rls.sql's CASE needed the matching change. A full-object snapshot
  // subsumes both checks and surfaces ANY key or value change as a diff that has to be
  // consciously accepted -- which is the "someone must decide" friction the design spec
  // (§3) actually wanted.
  it('matches its committed snapshot (any change here must be a deliberate, reviewed edit)', () => {
    expect(EVENT_SENSITIVITY).toMatchSnapshot()
  })
})
