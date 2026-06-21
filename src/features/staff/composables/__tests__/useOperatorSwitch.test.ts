import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// Audit log writes to PowerSync; stub the db so switchTo is testable in isolation.
vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

describe('useOperatorSwitch', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('sets the new active operator and does NOT touch the shift', async () => {
    const { useSessionStore }   = await import('@/store/session.store')
    const { useShiftStore }     = await import('@/features/shifts/shift.store')
    const { useOperatorSwitch } = await import('@/features/staff/composables/useOperatorSwitch')

    const shift    = useShiftStore()
    const closeSpy = vi.spyOn(shift, 'closeShift')
    const openSpy  = vi.spyOn(shift, 'openShift')
    const owner    = { id: 'o1', name: 'Owner', role: 'owner', permissions: {} } as any

    await useOperatorSwitch().switchTo(owner)

    expect(useSessionStore().activeStaff?.id).toBe('o1')
    expect(closeSpy).not.toHaveBeenCalled()
    expect(openSpy).not.toHaveBeenCalled()
  })

  it('writes an operator.switched audit row naming the previous and new operator', async () => {
    const { useSessionStore }   = await import('@/store/session.store')
    const { useOperatorSwitch } = await import('@/features/staff/composables/useOperatorSwitch')
    const { db }                = await import('@/data/powersync/db')

    const session = useSessionStore()
    session.setActiveStaff({ id: 's1', name: 'سامي', role: 'cashier', permissions: {} } as any)

    await useOperatorSwitch().switchTo({ id: 's2', name: 'أحمد', role: 'owner', permissions: {} } as any)

    const insertCall = vi.mocked(db.execute).mock.calls.find(
      c => typeof c[0] === 'string' && c[0].includes('INSERT INTO audit_log'),
    )
    expect(insertCall).toBeTruthy()
    expect(insertCall![1]).toEqual(expect.arrayContaining(['operator.switched', 'staff', 's2']))
    const meta = JSON.parse(
      (insertCall![1] as unknown[]).find(
        v => typeof v === 'string' && v.includes('to_staff_id'),
      ) as string,
    )
    expect(meta).toMatchObject({ from_staff_id: 's1', from_name: 'سامي', to_staff_id: 's2', to_name: 'أحمد' })
  })
})
