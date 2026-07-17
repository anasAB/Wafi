import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Staff } from '@/features/staff/staff.types'
import { OWNER_PERMISSIONS } from '@/features/staff/staff.types'

const state = {
  activeStaff: null as Staff | null,
  isShiftOpen: false,
}

vi.mock('@/store/session.store', () => ({
  useSessionStore: () => ({
    get activeStaff() {
      return state.activeStaff
    },
  }),
}))

vi.mock('@/features/shifts/shift.store', () => ({
  useShiftStore: () => ({
    get isShiftOpen() {
      return state.isShiftOpen
    },
  }),
}))

vi.mock('@/data/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(async () => ({ data: { session: { user: { id: 'owner-1' } } } })),
    },
  },
}))

import router from '../index'

const owner: Staff = {
  id: 'owner-1',
  shopId: 'shop-1',
  name: 'Owner',
  pinHash: 'hash',
  pinSalt: null,
  role: 'owner',
  permissions: OWNER_PERMISSIONS,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
}

describe('router shift-open guard (WAFI 5.3)', () => {
  beforeEach(async () => {
    state.activeStaff = owner
    state.isShiftOpen = false
    await router.replace('/')
  })

  it('redirects /pos to open-shift flow when no shift is open', async () => {
    await router.push('/pos')
    expect(router.currentRoute.value.path).toBe('/shifts/history')
  })

  it('redirects /pos/confirmation to open-shift flow when no shift is open', async () => {
    await router.push('/pos/confirmation')
    expect(router.currentRoute.value.path).toBe('/shifts/history')
  })

  it('allows /pos when a shift is open', async () => {
    state.isShiftOpen = true
    await router.push('/pos')
    expect(router.currentRoute.value.path).toBe('/pos')
  })

  it('allows /onboarding route directly', async () => {
    await router.push('/onboarding')
    expect(router.currentRoute.value.path).toBe('/onboarding')
  })
})
