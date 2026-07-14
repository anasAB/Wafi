import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))
vi.mock('@/data/supabase/client', () => ({
  supabase: {
    from: () => ({}),
    auth: {
      onAuthStateChange: vi.fn(),
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
  },
}))

import { useStaff } from '../useStaff'
import { db } from '@/data/powersync/db'
import { DEFAULT_CASHIER_PERMISSIONS } from '../../staff.types'

describe('useStaff.updateStaffPin (WAFI-014)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)
    vi.mocked(db.getOptional).mockResolvedValue({ name: 'أحمد' } as any)
  })

  it('writes a staff.pin_changed audit row when a PIN is changed', async () => {
    const { updateStaffPin } = useStaff()
    await updateStaffPin('staff-2', '4321')

    const auditCall = vi.mocked(db.execute).mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('INSERT INTO audit_log'),
    )
    expect(auditCall).toBeTruthy()
    expect(auditCall![1]).toEqual(expect.arrayContaining(['staff.pin_changed', 'staff', 'staff-2']))
  })

  it('still updates the pin_hash for the staff member', async () => {
    const { updateStaffPin } = useStaff()
    await updateStaffPin('staff-2', '4321')

    const updateCall = vi.mocked(db.execute).mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('UPDATE staff SET pin_hash'),
    )
    expect(updateCall).toBeTruthy()
  })
})

describe('useStaff.createStaff limit (Task 8 / 5 active staff)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('blocks creating a 6th active staff with clear Arabic message', async () => {
    vi.mocked(db.getOptional).mockImplementation(async (query: string) => {
      if (query.includes('COUNT(*) as count FROM staff WHERE shop_id = ? AND is_active = 1')) {
        return { count: 5 } as any
      }
      return null as any
    })
    vi.mocked(db.execute).mockResolvedValue({ rows: { _array: [] } } as any)

    const { createStaff } = useStaff()

    await expect(
      createStaff({
        name: 'موظف سادس',
        pin: '1234',
        role: 'cashier',
        permissions: DEFAULT_CASHIER_PERMISSIONS,
      })
    ).rejects.toThrow('وصلت إلى الحد الأقصى (5 موظفين) لباقتك')
  })

  it('allows creating after a deactivation frees a slot', async () => {
    let activeCount = 5
    const activeRows: Array<any> = [
      {
        id: 's-1', shop_id: 'shop-1', name: 'أحمد', pin_hash: 'h1', pin_salt: null,
        role: 'cashier', permissions: JSON.stringify(DEFAULT_CASHIER_PERMISSIONS), is_active: 1,
        created_at: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 's-2', shop_id: 'shop-1', name: 'سامي', pin_hash: 'h2', pin_salt: null,
        role: 'cashier', permissions: JSON.stringify(DEFAULT_CASHIER_PERMISSIONS), is_active: 1,
        created_at: '2026-01-02T00:00:00.000Z',
      },
      {
        id: 's-3', shop_id: 'shop-1', name: 'ليلى', pin_hash: 'h3', pin_salt: null,
        role: 'cashier', permissions: JSON.stringify(DEFAULT_CASHIER_PERMISSIONS), is_active: 1,
        created_at: '2026-01-03T00:00:00.000Z',
      },
      {
        id: 's-4', shop_id: 'shop-1', name: 'مها', pin_hash: 'h4', pin_salt: null,
        role: 'cashier', permissions: JSON.stringify(DEFAULT_CASHIER_PERMISSIONS), is_active: 1,
        created_at: '2026-01-04T00:00:00.000Z',
      },
      {
        id: 's-5', shop_id: 'shop-1', name: 'نور', pin_hash: 'h5', pin_salt: null,
        role: 'cashier', permissions: JSON.stringify(DEFAULT_CASHIER_PERMISSIONS), is_active: 1,
        created_at: '2026-01-05T00:00:00.000Z',
      },
    ]

    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('s-6')

    vi.mocked(db.getOptional).mockImplementation(async (query: string, params?: any[]) => {
      if (query.includes('COUNT(*) as count FROM staff WHERE shop_id = ? AND is_active = 1')) {
        return { count: activeCount } as any
      }
      if (query.includes('SELECT name FROM staff WHERE id = ?')) {
        const id = params?.[0]
        const row = activeRows.find(r => r.id === id)
        return row ? { name: row.name } as any : ({ name: id } as any)
      }
      return null as any
    })

    vi.mocked(db.execute).mockImplementation(async (query: string, params?: any[]) => {
      if (query.includes('UPDATE staff SET is_active = 0 WHERE id = ?')) {
        const id = params?.[0]
        const row = activeRows.find(r => r.id === id)
        if (row && row.is_active === 1) {
          row.is_active = 0
          activeCount -= 1
        }
      }

      if (query.includes('INSERT INTO staff')) {
        activeRows.push({
          id: params?.[0],
          shop_id: params?.[1],
          name: params?.[2],
          pin_hash: params?.[3],
          pin_salt: params?.[4],
          role: params?.[5],
          permissions: params?.[6],
          is_active: 1,
          created_at: params?.[7],
        })
        activeCount += 1
      }

      if (query.includes('SELECT * FROM staff WHERE shop_id = ? AND is_active = 1')) {
        return { rows: { _array: activeRows.filter(r => r.is_active === 1) } } as any
      }

      return { rows: { _array: [] } } as any
    })

    const { deactivateStaff, createStaff } = useStaff()
    await deactivateStaff('s-5')

    const created = await createStaff({
      name: 'موظف جديد',
      pin: '1234',
      role: 'cashier',
      permissions: DEFAULT_CASHIER_PERMISSIONS,
    })

    expect(created.id).toBe('s-6')
    expect(created.name).toBe('موظف جديد')
  })
})

describe('useStaff.loadStaff — double-encoded permissions (JSONB round-trip, migration 032)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('parses a double-encoded permissions column back into an object instead of silently reverting to role defaults', async () => {
    // Simulates a manager row synced through the old JSONB column: the
    // client's JSON string got wrapped in an extra layer of JSON encoding.
    const doubleEncoded = JSON.stringify(JSON.stringify({ can_view_reports: true, can_view_expenses: true }))
    vi.mocked(db.execute).mockResolvedValue({
      rows: {
        _array: [{
          id: 'm-1', shop_id: 'shop-1', name: 'مدير', pin_hash: 'h1', pin_salt: null,
          role: 'manager', permissions: doubleEncoded, is_active: 1,
          created_at: '2026-01-01T00:00:00.000Z',
        }],
      },
    } as any)

    const { staff, loadStaff } = useStaff()
    await loadStaff()

    expect(staff.value[0].permissions.can_view_reports).toBe(true)
    expect(staff.value[0].permissions.can_view_expenses).toBe(true)
  })
})
