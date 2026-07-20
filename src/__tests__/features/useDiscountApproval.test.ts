import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockExecute = vi.fn()

vi.mock('@/data/powersync/db', () => ({
  db: { execute: (...args: unknown[]) => mockExecute(...args) },
}))

vi.mock('@/store/device.store', () => ({
  useDeviceStore: () => ({ shopId: 'shop-1' }),
}))

import { findDiscountApprover } from '@/features/pos/useDiscountApproval'
import { hashPin, generateSalt } from '@/features/staff/composables/usePinAuth'

function rowsResult(rows: unknown[]) {
  return { rows: { _array: rows } }
}

beforeEach(() => {
  mockExecute.mockReset()
})

describe('findDiscountApprover', () => {
  it('returns the matching owner/manager when the PIN matches', async () => {
    const salt = generateSalt()
    const hash = await hashPin('4321', salt)
    mockExecute.mockResolvedValue(rowsResult([
      { id: 'staff-1', name: 'Owner Sam', role: 'owner', pin_hash: hash, pin_salt: salt },
    ]))

    const approver = await findDiscountApprover('4321')
    expect(approver).toEqual({ id: 'staff-1', name: 'Owner Sam', role: 'owner' })
  })

  it('returns null when no owner/manager PIN matches', async () => {
    const salt = generateSalt()
    const hash = await hashPin('4321', salt)
    mockExecute.mockResolvedValue(rowsResult([
      { id: 'staff-1', name: 'Owner Sam', role: 'owner', pin_hash: hash, pin_salt: salt },
    ]))

    const approver = await findDiscountApprover('0000')
    expect(approver).toBeNull()
  })

  it('only queries owner/manager roles, never a cashier PIN', async () => {
    mockExecute.mockResolvedValue(rowsResult([]))
    await findDiscountApprover('1234')
    const [sql] = mockExecute.mock.calls[0]
    expect(sql).toContain(`role IN ('owner', 'manager')`)
  })
})
