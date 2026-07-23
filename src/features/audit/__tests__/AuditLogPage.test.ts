import { describe, it, expect } from 'vitest'
import type { AuditEvent } from '@/features/audit/audit.types'

// The full set of event types useAuditLog.ts can produce (audit.types.ts's
// AuditEvent union) -- copied here as a literal list so this test doesn't
// depend on TypeScript type-level reflection (not available at runtime).
// If this list and audit.types.ts's union ever diverge, update BOTH.
const ALL_AUDIT_EVENTS: AuditEvent[] = [
  'sale.completed', 'sale.deleted', 'return.processed',
  'product.created', 'product.updated', 'product.deleted', 'product.price_changed',
  'expense.created', 'expense.updated', 'expense.deleted',
  'customer.created', 'customer.updated', 'customer.deleted', 'customer.payment_recorded',
  'stock.adjusted', 'shift.opened', 'shift.closed', 'shift.force_closed',
  'exchange_rate.changed', 'settings.receipt_updated',
  'staff.created', 'staff.updated', 'staff.deactivated', 'staff.permissions_changed',
  'staff.pin_changed', 'staff.recovery_codes_generated', 'staff.recovery_code_used',
  'auth.login_failed', 'auth.locked_out',
  'supplier.created', 'supplier.updated', 'receiving.created',
  'operator.switched', 'cash_movement.recorded', 'cash_movement.voided',
  'stock_take.completed',
  'installment_plan.created', 'installment_payment.recorded', 'installment_plan.cancelled',
  'sync.dead_letter_discarded',
  'category.merged', 'category.deleted_with_reassign',
  'device.renamed', 'device.deactivated', 'device.reactivated',
  'staff_ledger.entry_created', 'staff_settlement.finalized', 'staff_settlement.paid',
]

describe('AuditLogPage event filter coverage', () => {
  it('lists every AuditEvent type as a filter option', async () => {
    // Import the module and reach into its script setup isn't possible for a
    // plain array constant without mounting the component; instead, read the
    // component's source and extract the eventOptions array's event values via
    // a lightweight regex -- avoids needing a full component mount just to
    // check a static list.
    const fs = await import('node:fs')
    const path = await import('node:path')
    const src = fs.readFileSync(
      path.resolve(__dirname, '../AuditLogPage.vue'),
      'utf-8',
    )
    const matches = [...src.matchAll(/value:\s*'([a-z_.]+)'/g)].map(m => m[1])

    const missing = ALL_AUDIT_EVENTS.filter(e => !matches.includes(e))
    expect(missing).toEqual([])
  })
})
