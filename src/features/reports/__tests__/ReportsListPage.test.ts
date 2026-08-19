// src/features/reports/__tests__/ReportsListPage.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/store/session.store', () => ({ useSessionStore: () => ({ activeStaff: { role: 'owner', permissions: {} } }) }))
vi.mock('@/store/device.store', () => ({ useDeviceStore: () => ({ shopId: 'shop1' }) }))
// ReportsListPage imports from ./index (Task 19b's barrel), which imports all
// 13 real definition files -- each of those imports the real db singleton
// (@/data/powersync/db), which would otherwise try to initialize a real
// PowerSync client in this test environment. Mock it here so merely
// IMPORTING the barrel doesn't attempt that (matching every other test file
// in this plan's own convention for any file that touches ./index).
vi.mock('@/data/powersync/db', () => ({ db: { getAll: vi.fn().mockResolvedValue([]), getOptional: vi.fn().mockResolvedValue(null) } }))
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  useRoute: () => ({ params: {} }),
}))

import ReportsListPage from '../ReportsListPage.vue'

describe('ReportsListPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('lists every registered report by name, without calling compute', async () => {
    const computeSpy = vi.fn()
    const { REPORT_DEFINITIONS } = await import('../index')
    REPORT_DEFINITIONS['daily-closing'] = { id: 'daily-closing', name: 'Daily Closing Report', cadenceHint: 'daily', compute: computeSpy }

    const wrapper = mount(ReportsListPage, { global: { stubs: { AppHeader: true, RouterLink: true } } })
    expect(wrapper.text()).toContain('Daily Closing Report')
    expect(computeSpy).not.toHaveBeenCalled()
  })
})
