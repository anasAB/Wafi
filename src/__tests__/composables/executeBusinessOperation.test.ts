import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// Static top-level mock (not per-test vi.doMock) — this repo's vitest config has no
// resetModules/restoreMocks wired up, so a per-test doMock wouldn't reliably take
// effect between tests. Mocking here and reconfiguring the mock per-test with
// mockImplementationOnce/mockResolvedValue achieves the same isolation without
// depending on module-registry resets.
vi.mock('@/services/events/publishEvent', () => ({
  publishEvent: vi.fn().mockResolvedValue(undefined),
}))

import {
  ExpenseEventType, InventoryEventType, CustomerEventType, SalesEventType, StaffEventType,
} from '@/services/events/domainEvent.types'
import { executeBusinessOperation } from '@/composables/executeBusinessOperation'
import { publishEvent } from '@/services/events/publishEvent'
import { useSessionStore } from '@/store/session.store'
import type { Staff } from '@/features/staff/staff.types'

describe('per-domain event type registries', () => {
  it('ExpenseEventType has exactly the expense event(s)', () => {
    expect(Object.values(ExpenseEventType)).toEqual(['expense.recorded'])
  })
  it('InventoryEventType has exactly the inventory events', () => {
    expect(Object.values(InventoryEventType)).toEqual(['stock.received', 'inventory.adjusted'])
  })
  it('CustomerEventType has exactly the customer events', () => {
    expect(Object.values(CustomerEventType)).toEqual(['customer.debt_changed', 'installment.due_paid'])
  })
  it('SalesEventType has exactly the sales events', () => {
    expect(Object.values(SalesEventType)).toEqual(['sale.completed'])
  })
  it('StaffEventType has exactly the staff events', () => {
    expect(Object.values(StaffEventType)).toEqual([
      'shift.opened', 'shift.closed', 'settlement.paid', 'staff.ledger_entry_added',
    ])
  })
})

describe('executeBusinessOperation', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.mocked(publishEvent).mockReset().mockResolvedValue(undefined)
  })

  it('runs write then audit, in order, and awaits both before resolving', async () => {
    const order: string[] = []
    const write = vi.fn().mockImplementation(async () => { order.push('write'); return { id: 'abc' } })
    const audit = vi.fn().mockImplementation(async () => { order.push('audit') })
    const toEvent = vi.fn().mockReturnValue({
      type: ExpenseEventType.Recorded, entityId: 'abc', payload: { expenseId: 'abc' },
      staffId: 's1', shopId: 'shop1', occurredAt: '2026-07-30T00:00:00.000Z',
    })

    const result = await executeBusinessOperation(write, { audit, toEvent })

    expect(result).toEqual({ id: 'abc' })
    expect(order).toEqual(['write', 'audit'])
    expect(audit).toHaveBeenCalledWith({ id: 'abc' })
  })

  it('does not require toEvent — omitting it publishes nothing and does not throw', async () => {
    const write = vi.fn().mockResolvedValue({ id: 'abc' })
    const audit = vi.fn().mockResolvedValue(undefined)

    await expect(executeBusinessOperation(write, { audit })).resolves.toEqual({ id: 'abc' })
    expect(publishEvent).not.toHaveBeenCalled()
  })

  it('resolves the caller before publish settles — publish is fire-and-forget', async () => {
    const write = vi.fn().mockResolvedValue({ id: 'abc' })
    const audit = vi.fn().mockResolvedValue(undefined)
    let publishResolved = false
    vi.mocked(publishEvent).mockImplementation(
      () => new Promise((r) => setTimeout(() => { publishResolved = true; r(undefined) }, 50)),
    )
    const toEvent = vi.fn().mockReturnValue({
      type: ExpenseEventType.Recorded, entityId: 'abc', payload: {}, staffId: 's1', shopId: 'shop1', occurredAt: 'now',
    })

    await executeBusinessOperation(write, { audit, toEvent })
    expect(publishResolved).toBe(false)  // the call above returned before the 50ms publish settled
  })

  it('throws before writing when requiredPermission is not satisfied', async () => {
    const session = useSessionStore()
    session.setActiveStaff({ id: 's1', role: 'cashier', permissions: {} } as Staff)
    const write = vi.fn()
    const audit = vi.fn()

    await expect(
      executeBusinessOperation(write, { audit }, 'can_view_expenses'),
    ).rejects.toThrow('permission denied: can_view_expenses required')
    expect(write).not.toHaveBeenCalled()
  })

  it('does not call audit or toEvent when write throws', async () => {
    const write = vi.fn().mockRejectedValue(new Error('db down'))
    const audit = vi.fn()
    const toEvent = vi.fn()

    await expect(executeBusinessOperation(write, { audit, toEvent })).rejects.toThrow('db down')
    expect(audit).not.toHaveBeenCalled()
    expect(toEvent).not.toHaveBeenCalled()
  })

  it('a publish failure does not reject the caller (fire-and-forget swallows errors)', async () => {
    vi.mocked(publishEvent).mockRejectedValue(new Error('bus unavailable'))
    const write = vi.fn().mockResolvedValue({ id: 'abc' })
    const audit = vi.fn().mockResolvedValue(undefined)
    const toEvent = vi.fn().mockReturnValue({
      type: ExpenseEventType.Recorded, entityId: 'abc', payload: {}, staffId: 's1', shopId: 'shop1', occurredAt: 'now',
    })

    await expect(executeBusinessOperation(write, { audit, toEvent })).resolves.toEqual({ id: 'abc' })
  })
})
