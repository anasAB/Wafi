import { describe, it, expect } from 'vitest'
import { canUserDo } from '@/router/permissions'
import type { Staff } from '@/features/staff/staff.types'

const cashier = { id: 'c', name: 'كاشير', role: 'cashier',
  permissions: { can_view_reports: false } } as unknown as Staff
const owner = { id: 'o', name: 'مالك', role: 'owner', permissions: {} } as unknown as Staff

describe('/reports permission', () => {
  it('owner may view reports', () => {
    expect(canUserDo(owner, 'can_view_reports')).toBe(true)
  })
  it('a cashier without can_view_reports may not', () => {
    expect(canUserDo(cashier, 'can_view_reports')).toBe(false)
  })
})
