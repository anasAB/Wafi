import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/__tests__/__mocks__/db'))

vi.mock('virtual:pwa-register', () => ({
  registerSW: () => vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ path: '/pos' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  RouterView: { name: 'RouterView', template: '<div />' },
}))

const {
  refreshShopIdMock,
  hasAnyStaffMock,
  loadActiveShiftMock,
  reconcileSequenceFromDbMock,
  startRetryQueueSweeperMock,
  startDailyEventCountsProjectionMock,
  startEventTableCleanupSweeperMock,
} = vi.hoisted(() => ({
  refreshShopIdMock: vi.fn().mockResolvedValue(undefined),
  hasAnyStaffMock: vi.fn().mockResolvedValue(true),
  loadActiveShiftMock: vi.fn().mockResolvedValue(undefined),
  reconcileSequenceFromDbMock: vi.fn().mockResolvedValue(undefined),
  startRetryQueueSweeperMock: vi.fn(),
  startDailyEventCountsProjectionMock: vi.fn(),
  startEventTableCleanupSweeperMock: vi.fn(),
}))

vi.mock('@/store/device.store', () => ({
  useDeviceStore: () => ({ shopId: 'shop-1', refreshShopId: refreshShopIdMock }),
}))

vi.mock('@/features/staff/composables/useStaff', () => ({
  useStaff: () => ({ hasAnyStaff: hasAnyStaffMock }),
}))

vi.mock('@/features/shifts/composables/useShift', () => ({
  useShift: () => ({ loadActiveShift: loadActiveShiftMock }),
}))

vi.mock('@/store/sale.store', () => ({
  useSaleStore: () => ({ reconcileSequenceFromDb: reconcileSequenceFromDbMock }),
}))

vi.mock('@/composables/useIdleLock', () => ({
  useIdleLock: () => ({ locked: { value: false }, unlock: vi.fn() }),
}))

vi.mock('@/services/events/eventPublishRetryQueue', () => ({
  startRetryQueueSweeper: startRetryQueueSweeperMock,
}))

vi.mock('@/services/events/dailyEventCountsProjection', () => ({
  startDailyEventCountsProjection: startDailyEventCountsProjectionMock,
}))

vi.mock('@/services/events/cleanupLocalEventTables', () => ({
  startEventTableCleanupSweeper: startEventTableCleanupSweeperMock,
}))

import App from '@/App.vue'

describe('App.vue onMounted', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    refreshShopIdMock.mockResolvedValue(undefined)
    hasAnyStaffMock.mockResolvedValue(true)
    loadActiveShiftMock.mockResolvedValue(undefined)
    reconcileSequenceFromDbMock.mockResolvedValue(undefined)
  })

  const mountOpts = {
    global: {
      stubs: {
        LockScreen: true,
        IdleLockOverlay: true,
        AppSidebar: true,
        AppBottomNav: true,
        AppToast: true,
        RouterView: true,
      },
    },
  }

  it('starts the event-publish retry queue sweeper on mount (Sprint 2 final-review fix)', async () => {
    mount(App, mountOpts)
    await flushPromises()
    expect(startRetryQueueSweeperMock).toHaveBeenCalled()
  })

  it('starts the daily-event-counts projection on mount (Sprint 1 dormancy fix)', async () => {
    mount(App, mountOpts)
    await flushPromises()
    expect(startDailyEventCountsProjectionMock).toHaveBeenCalledWith('shop-1')
  })

  it('starts the event-table cleanup sweeper on mount', async () => {
    mount(App, mountOpts)
    await flushPromises()
    expect(startEventTableCleanupSweeperMock).toHaveBeenCalled()
  })

  it('does not start the sweepers/projection when there is no staff yet (setup-owner gate)', async () => {
    hasAnyStaffMock.mockResolvedValue(false)
    mount(App, mountOpts)
    await flushPromises()
    expect(startRetryQueueSweeperMock).not.toHaveBeenCalled()
    expect(startDailyEventCountsProjectionMock).not.toHaveBeenCalled()
    expect(startEventTableCleanupSweeperMock).not.toHaveBeenCalled()
  })
})
