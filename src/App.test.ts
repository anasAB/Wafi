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
  startDashboardRevenueProjectionMock,
  startProfitCacheProjectionMock,
  startNotificationSubscribersMock,
  startAuditSubscribersMock,
  startProcessingRetrySweeperMock,
  startDeferredJobWorkerMock,
  checkDeviceSyncStalenessMock,
  checkHealthAlertsMock,
} = vi.hoisted(() => ({
  refreshShopIdMock: vi.fn().mockResolvedValue(undefined),
  hasAnyStaffMock: vi.fn().mockResolvedValue(true),
  loadActiveShiftMock: vi.fn().mockResolvedValue(undefined),
  reconcileSequenceFromDbMock: vi.fn().mockResolvedValue(undefined),
  startRetryQueueSweeperMock: vi.fn(),
  startDailyEventCountsProjectionMock: vi.fn(),
  startEventTableCleanupSweeperMock: vi.fn(),
  // These six were never mocked here even though App.vue's onMounted calls
  // them for real on every mount (found while investigating this file's
  // OOM): each registers a live PowerSync db.watch()-backed subscriber with
  // no corresponding unmount() between this file's 4 mounts, so subscriptions
  // accumulated unboundedly against the mocked db across the whole test file.
  startDashboardRevenueProjectionMock: vi.fn().mockReturnValue({ stop: vi.fn() }),
  startProfitCacheProjectionMock: vi.fn().mockReturnValue({ stop: vi.fn() }),
  startNotificationSubscribersMock: vi.fn().mockReturnValue({ stop: vi.fn() }),
  startAuditSubscribersMock: vi.fn().mockReturnValue({ stop: vi.fn() }),
  startProcessingRetrySweeperMock: vi.fn(),
  startDeferredJobWorkerMock: vi.fn().mockReturnValue({ stop: vi.fn() }),
  checkDeviceSyncStalenessMock: vi.fn().mockResolvedValue(undefined),
  checkHealthAlertsMock: vi.fn().mockResolvedValue(undefined),
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

vi.mock('@/services/events/dashboardRevenueProjection', () => ({
  startDashboardRevenueProjection: startDashboardRevenueProjectionMock,
}))

vi.mock('@/services/events/profitCacheProjection', () => ({
  startProfitCacheProjection: startProfitCacheProjectionMock,
}))

vi.mock('@/services/events/notificationSubscriber', () => ({
  startNotificationSubscribers: startNotificationSubscribersMock,
  handleDiscountEvent: vi.fn(),
}))

vi.mock('@/services/events/auditSubscriber', () => ({
  startAuditSubscribers: startAuditSubscribersMock,
  handleAuditableEvent: vi.fn(),
}))

vi.mock('@/services/events/eventProcessingRetryQueue', () => ({
  startProcessingRetrySweeper: startProcessingRetrySweeperMock,
}))

vi.mock('@/services/events/deferredJobWorker', () => ({
  startDeferredJobWorker: startDeferredJobWorkerMock,
}))

vi.mock('@/services/notifications/syncStalenessCheck', () => ({
  checkDeviceSyncStaleness: checkDeviceSyncStalenessMock,
}))

vi.mock('@/features/health/alerting/healthAlertCheck', () => ({
  checkHealthAlerts: checkHealthAlertsMock,
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

  it('runs the health alerts foreground evaluator on mount (WAFI-148A Task 10)', async () => {
    mount(App, mountOpts)
    await flushPromises()
    expect(checkHealthAlertsMock).toHaveBeenCalled()
  })

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
