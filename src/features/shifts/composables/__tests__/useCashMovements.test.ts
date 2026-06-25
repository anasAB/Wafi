import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { useCashMovements } from '../useCashMovements'
import { db } from '@/data/powersync/db'
import type { CashierShift } from '../../shift.types'

const openShift: CashierShift = {
  id: 'shift-1', shopId: 's', deviceId: 'd', staffId: 'st',
  openedAt: '2026-06-25T06:00:00Z', closedAt: null,
  openingCashUsd: 100, openingCashSyp: 50_000,
  closingCashUsd: null, closingCashSyp: null,
  varianceUsd: null, varianceSyp: null, closeNote: null,
  forceClosedBy: null, zReportData: null, status: 'open',
}

function sqlOf(c: any[]): string { return c[0] as string }
function paramsOf(c: any[]): unknown[] { return c[1] as unknown[] }

describe('useCashMovements', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
  })

  it('record inserts a movement row with the right direction/currency/amount', async () => {
    const { record } = useCashMovements()
    const id = await record({
      shift: openShift, direction: 'out', category: 'paid_supplier',
      currency: 'USD', amount: 80, note: 'مورد الكهربائيات',
    })
    expect(id).toBeTruthy()
    const ins = vi.mocked(db.execute).mock.calls.find(c => /INSERT INTO cash_movements/.test(sqlOf(c)))
    expect(ins).toBeDefined()
    const p = paramsOf(ins!)
    expect(p).toContain('out')
    expect(p).toContain('paid_supplier')
    expect(p).toContain('USD')
    expect(p).toContain(80)
    expect(p).toContain('مورد الكهربائيات')
  })

  it('record rejects a non-open shift', async () => {
    const { record } = useCashMovements()
    await expect(record({
      shift: { ...openShift, status: 'closed' }, direction: 'out',
      category: 'drop_to_safe', currency: 'USD', amount: 10,
    })).rejects.toThrow()
  })

  it('record rejects amount <= 0 and non-integer SYP', async () => {
    const { record } = useCashMovements()
    await expect(record({
      shift: openShift, direction: 'in', category: 'float_topup',
      currency: 'USD', amount: 0,
    })).rejects.toThrow()
    await expect(record({
      shift: openShift, direction: 'out', category: 'drop_to_safe',
      currency: 'SYP', amount: 12345.5,
    })).rejects.toThrow()
  })

  it('voidMovement inserts a reversing row (opposite direction, same amount, pointing at original)', async () => {
    vi.mocked(db.getOptional).mockImplementation(async (sql: string) => {
      if (/voids_movement_id\s*=/.test(sql)) return undefined as any // no existing void
      return {                                                       // the original
        id: 'm-1', shop_id: 's', device_id: 'd', shift_id: 'shift-1', staff_id: 'st',
        direction: 'out', category: 'paid_supplier', currency: 'USD', amount: 80,
        note: null, voids_movement_id: null, created_at: '2026-06-25T07:00:00Z',
      } as any
    })
    const { voidMovement } = useCashMovements()
    await voidMovement('m-1', 'مبلغ خاطئ')
    const ins = vi.mocked(db.execute).mock.calls.find(c => /INSERT INTO cash_movements/.test(sqlOf(c)))
    const p = paramsOf(ins!)
    expect(p).toContain('in')      // reversed from 'out'
    expect(p).toContain(80)        // same amount
    expect(p).toContain('m-1')     // voids_movement_id → original
  })

  it('voidMovement refuses to void a void entry', async () => {
    vi.mocked(db.getOptional).mockResolvedValueOnce({
      id: 'v-1', shop_id: 's', device_id: 'd', shift_id: 'shift-1', staff_id: 'st',
      direction: 'in', category: 'paid_supplier', currency: 'USD', amount: 80,
      note: null, voids_movement_id: 'm-1', created_at: 'x',
    } as any)
    const { voidMovement } = useCashMovements()
    await expect(voidMovement('v-1', 'x')).rejects.toThrow()
  })

  it('listForShift maps rows scoped by shift_id', async () => {
    vi.mocked(db.getAll).mockResolvedValueOnce([{
      id: 'm-1', shop_id: 's', device_id: 'd', shift_id: 'shift-1', staff_id: 'st',
      direction: 'out', category: 'drop_to_safe', currency: 'SYP', amount: 300_000,
      note: null, voids_movement_id: null, created_at: 'x',
    }] as any)
    const { listForShift } = useCashMovements()
    const list = await listForShift('shift-1')
    expect(list).toHaveLength(1)
    expect(list[0].currency).toBe('SYP')
    expect(list[0].voidsMovementId).toBeNull()
    const call = vi.mocked(db.getAll).mock.calls[0]
    expect(/shift_id\s*=\s*\?/.test(sqlOf(call))).toBe(true)
  })
})
