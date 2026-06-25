import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import { mount, flushPromises } from '@vue/test-utils'
import { i18n } from '@/i18n'
import { db } from '@/data/powersync/db'
import { useSessionStore } from '@/store/session.store'
import ShiftDetailScreen from '@/features/shifts/components/ShiftDetailScreen.vue'

const shiftRow = {
  id: 'shift-1', shop_id: 's', device_id: 'd', staff_id: 'st',
  opened_at: '2026-06-25T06:00:00Z', closed_at: null,
  opening_cash_usd: 100, opening_cash_syp: 0,
  closing_cash_usd: null, closing_cash_syp: null, variance_usd: null,
  variance_syp: null, close_note: null, force_closed_by: null,
  z_report_data: null, status: 'open',
}

let router: Router

describe('ShiftDetailScreen — cash movements section', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    vi.clearAllMocks()

    // Owner session → can_view_reports passes, so the money-gated section renders.
    useSessionStore().setActiveStaff({ id: 'o1', name: 'المالك', role: 'owner' } as any)

    // Shift load goes through getOptional (cashier_shifts); everything else → zero/empty.
    vi.mocked(db.getOptional).mockImplementation(async (sql: string) =>
      /cashier_shifts/.test(sql) ? (shiftRow as any) : null)
    // The cash_movements list query returns one movement; other getAll queries empty.
    vi.mocked(db.getAll).mockImplementation(async (sql: string) =>
      /FROM cash_movements/.test(sql)
        ? ([{
            id: 'm-1', shop_id: 's', device_id: 'd', shift_id: 'shift-1', staff_id: 'st',
            direction: 'out', category: 'paid_supplier', currency: 'USD', amount: 80,
            note: null, voids_movement_id: null, created_at: 'x',
          }] as any)
        : ([] as any))

    router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/shifts/:id', component: { template: '<div/>' } }],
    })
    await router.push('/shifts/shift-1')
    await router.isReady()
  })

  it('lists the shift’s cash movements', async () => {
    const w = mount(ShiftDetailScreen, {
      global: { plugins: [i18n, router] },
    })
    await flushPromises()
    expect(w.text()).toContain('دفع لمورد')
  })
})
