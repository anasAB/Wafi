// src/features/reports/__tests__/ReportDetailPage.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

// useSessionStore and useRoute are wrapped in vi.fn() (not plain arrow functions)
// specifically so later tests can call vi.mocked(...).mockReturnValue(...) to
// change the active staff / selected reportId per-test, per Task 0 P0 finding 3.
vi.mock('@/store/session.store', () => ({ useSessionStore: vi.fn(() => ({ activeStaff: { role: 'owner', permissions: {} } })) }))
vi.mock('@/store/device.store', () => ({ useDeviceStore: () => ({ shopId: 'shop1' }) }))
vi.mock('vue-router', async (orig) => ({ ...(await orig<any>()), useRoute: vi.fn(() => ({ params: { reportId: 'daily-closing' } })) }))

const mockGetAll = vi.fn().mockResolvedValue([])
// WAFI-147B: ReportDetailPage's generate() now checks for a persisted
// snapshot via db.getOptional() before calling compute() -- returning
// undefined here preserves this suite's pre-147B behavior (always falls
// through to the live compute() path being tested).
const mockGetOptional = vi.fn().mockResolvedValue(undefined)
vi.mock('@/data/powersync/db', () => ({ db: { getAll: (...a: unknown[]) => mockGetAll(...a), getOptional: (...a: unknown[]) => mockGetOptional(...a) } }))

import ReportDetailPage from '../ReportDetailPage.vue'
import { REPORT_DEFINITIONS } from '../index'

// Create a mock router for the tests
const createMockRouter = () => ({
  push: vi.fn(),
  back: vi.fn(),
  currentRoute: { value: { params: { reportId: 'daily-closing' } } },
})

describe('ReportDetailPage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mockGetAll.mockClear()
    mockGetAll.mockResolvedValue([])
    mockGetOptional.mockClear()
    mockGetOptional.mockResolvedValue(undefined)
  })

  it('calls compute() exactly once for the selected report, with a local-calendar-date range, and renders its sections', async () => {
    const computeSpy = vi.fn().mockResolvedValue({
      id: 'daily-closing', name: 'Daily Closing Report',
      dateRange: { from: '2026-08-18', to: '2026-08-18' }, generatedAt: '2026-08-18T00:00:00.000Z',
      sections: [{ type: 'summary', title: 'Totals', metrics: [{ label: 'Revenue', value: 100 }], visibility: 'shop' }],
    })
    REPORT_DEFINITIONS['daily-closing'] = { id: 'daily-closing', name: 'Daily Closing Report', cadenceHint: 'daily', compute: computeSpy }

    const wrapper = mount(ReportDetailPage, { global: { mocks: { $router: createMockRouter() } } })
    await flushPromises()

    expect(computeSpy).toHaveBeenCalledTimes(1)
    // exactly YYYY-MM-DD, sourced from local date parts, not toISOString()
    expect(computeSpy.mock.calls[0][1].from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(wrapper.text()).toContain('Daily Closing Report')
    expect(wrapper.text()).toContain('Totals')
  })

  it('shows a staff selector and withholds compute() until a staff member is chosen, for a per-shift report', async () => {
    mockGetAll.mockResolvedValueOnce([{ id: 's1', name: 'Ali' }])
    const computeSpy = vi.fn().mockResolvedValue({
      id: 'employee-summary', name: 'Employee Summary',
      dateRange: { from: '2026-08-18', to: '2026-08-18' }, generatedAt: '2026-08-18T00:00:00.000Z',
      sections: [{ type: 'summary', title: 'Ali', metrics: [], visibility: 'staff' }],
    })
    REPORT_DEFINITIONS['employee-summary'] = { id: 'employee-summary', name: 'Employee Summary', cadenceHint: 'per-shift', contextRequirement: 'staff', compute: computeSpy }

    const vueRouterForStaffTest = await import('vue-router')
    vi.mocked(vueRouterForStaffTest.useRoute).mockReturnValue({ params: { reportId: 'employee-summary' } } as any)
    const wrapper = mount(ReportDetailPage, { global: { mocks: { $router: createMockRouter() } } })
    await flushPromises()

    expect(computeSpy).not.toHaveBeenCalled() // withheld until staff is chosen

    // Update the selectedStaffId ref directly
    ;(wrapper.vm as any).selectedStaffId = 's1'
    await wrapper.vm.$nextTick()
    await flushPromises()

    expect(computeSpy).toHaveBeenCalledWith('shop1', expect.any(Object), { staffId: 's1' })
  })

  it('omits a staff-visibility section for a viewer without can_view_staff_performance, without hiding the rest of the report (Task 0 P0 finding 3)', async () => {
    const sessionModule = await import('@/store/session.store')
    vi.mocked(sessionModule.useSessionStore).mockReturnValue({ activeStaff: { role: 'cashier', permissions: {} } } as any)

    const computeSpy = vi.fn().mockResolvedValue({
      id: 'weekly-summary', name: 'Weekly Summary',
      dateRange: { from: '2026-08-12', to: '2026-08-18' }, generatedAt: '2026-08-18T00:00:00.000Z',
      sections: [
        { type: 'summary', title: 'Week over Week', metrics: [], visibility: 'shop' },
        { type: 'detail', title: 'Staff Ranking', columns: [], rows: [], visibility: 'staff' },
      ],
    })
    REPORT_DEFINITIONS['weekly-summary'] = { id: 'weekly-summary', name: 'Weekly Summary', cadenceHint: 'weekly', compute: computeSpy }
    const vueRouter = await import('vue-router')
    vi.mocked(vueRouter.useRoute).mockReturnValue({ params: { reportId: 'weekly-summary' } } as any)

    const wrapper = mount(ReportDetailPage, { global: { mocks: { $router: createMockRouter() } } })
    await flushPromises()

    expect(wrapper.text()).toContain('Week over Week') // shop-visibility section still renders
    expect(wrapper.text()).not.toContain('Staff Ranking') // staff-visibility section omitted, not the whole report

    vi.mocked(sessionModule.useSessionStore).mockReturnValue({ activeStaff: { role: 'owner', permissions: {} } } as any)
  })

  it('whole-report gates Employee Summary for a viewer without can_view_staff_performance -- no staff query, no compute() call (Task 0 P0 finding 5)', async () => {
    const sessionModule = await import('@/store/session.store')
    vi.mocked(sessionModule.useSessionStore).mockReturnValue({ activeStaff: { role: 'cashier', permissions: {} } } as any)
    mockGetAll.mockClear()

    const computeSpy = vi.fn()
    REPORT_DEFINITIONS['employee-summary'] = { id: 'employee-summary', name: 'Employee Summary', cadenceHint: 'per-shift', contextRequirement: 'staff', compute: computeSpy }
    const vueRouter = await import('vue-router')
    vi.mocked(vueRouter.useRoute).mockReturnValue({ params: { reportId: 'employee-summary' } } as any)

    const wrapper = mount(ReportDetailPage, { global: { mocks: { $router: createMockRouter() } } })
    await flushPromises()

    expect(wrapper.find('[data-testid="not-authorized"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="staff-select"]').exists()).toBe(false)
    // Whole-report gate prevents the staff-list query specifically. (AppHeader's
    // always-mounted SyncIndicator independently calls db.getAll for its own
    // ps_crud/dead-letter counts via the same globally-mocked db module, so a
    // blanket "never called" assertion would be checking unrelated UI chrome
    // rather than this report's own authorization gate.)
    expect(mockGetAll).not.toHaveBeenCalledWith(expect.stringContaining('FROM staff'), expect.anything())
    expect(computeSpy).not.toHaveBeenCalled()

    vi.mocked(sessionModule.useSessionStore).mockReturnValue({ activeStaff: { role: 'owner', permissions: {} } } as any)
  })

  it('preserves compute()\'s section order when rendering mixed summary/detail sections', async () => {
    const computeSpy = vi.fn().mockResolvedValue({
      id: 'daily-closing', name: 'Daily Closing Report',
      dateRange: { from: '2026-08-18', to: '2026-08-18' }, generatedAt: '2026-08-18T00:00:00.000Z',
      sections: [
        { type: 'summary', title: 'Sales Totals', metrics: [], visibility: 'shop' },
        { type: 'summary', title: 'Cash Reconciliation', metrics: [], visibility: 'shop' },
        { type: 'detail', title: 'Top 5 Products', columns: [], rows: [], visibility: 'shop' },
      ],
    })
    REPORT_DEFINITIONS['daily-closing'] = { id: 'daily-closing', name: 'Daily Closing Report', cadenceHint: 'daily', compute: computeSpy }
    const vueRouter = await import('vue-router')
    vi.mocked(vueRouter.useRoute).mockReturnValue({ params: { reportId: 'daily-closing' } } as any)

    const wrapper = mount(ReportDetailPage, { global: { mocks: { $router: createMockRouter() } } })
    await flushPromises()

    const text = wrapper.text()
    expect(text.indexOf('Cash Reconciliation')).toBeLessThan(text.indexOf('Top 5 Products'))
  })

  it('re-derives definition/range and re-computes when route.params.reportId changes (I9)', async () => {
    const { reactive } = await import('vue')
    const reactiveRoute = reactive({ params: { reportId: 'daily-closing' } })
    const vueRouter = await import('vue-router')
    vi.mocked(vueRouter.useRoute).mockReturnValue(reactiveRoute as any)

    const dailyComputeSpy = vi.fn().mockResolvedValue({
      id: 'daily-closing', name: 'Daily Closing Report',
      dateRange: { from: '2026-08-18', to: '2026-08-18' }, generatedAt: '2026-08-18T00:00:00.000Z',
      sections: [{ type: 'summary', title: 'Daily Totals', metrics: [], visibility: 'shop' }],
    })
    const weeklyComputeSpy = vi.fn().mockResolvedValue({
      id: 'weekly-summary', name: 'Weekly Summary',
      dateRange: { from: '2026-08-12', to: '2026-08-18' }, generatedAt: '2026-08-18T00:00:00.000Z',
      sections: [{ type: 'summary', title: 'Weekly Totals', metrics: [], visibility: 'shop' }],
    })
    REPORT_DEFINITIONS['daily-closing'] = { id: 'daily-closing', name: 'Daily Closing Report', cadenceHint: 'daily', compute: dailyComputeSpy }
    REPORT_DEFINITIONS['weekly-summary'] = { id: 'weekly-summary', name: 'Weekly Summary', cadenceHint: 'weekly', compute: weeklyComputeSpy }

    const wrapper = mount(ReportDetailPage, { global: { mocks: { $router: createMockRouter() } } })
    await flushPromises()

    expect(dailyComputeSpy).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('Daily Totals')

    reactiveRoute.params.reportId = 'weekly-summary'
    await flushPromises()

    expect(weeklyComputeSpy).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('Weekly Totals')
    expect(wrapper.text()).not.toContain('Daily Totals')
  })

  it('applies only the newest generate() call\'s result when an older call resolves later (race guard, I9)', async () => {
    const vueRouter = await import('vue-router')
    vi.mocked(vueRouter.useRoute).mockReturnValue({ params: { reportId: 'daily-closing' } } as any)

    let resolveFirst!: (v: any) => void
    let resolveSecond!: (v: any) => void
    const first = new Promise((resolve) => { resolveFirst = resolve })
    const second = new Promise((resolve) => { resolveSecond = resolve })
    const computeSpy = vi.fn()
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => second)
    REPORT_DEFINITIONS['daily-closing'] = { id: 'daily-closing', name: 'Daily Closing Report', cadenceHint: 'daily', compute: computeSpy }

    const wrapper = mount(ReportDetailPage, { global: { mocks: { $router: createMockRouter() } } })
    await flushPromises() // triggers the first (onMounted) generate() call

    // Trigger a second generate() call before the first resolves.
    await wrapper.find('[data-testid="regenerate-button"]').trigger('click')
    await flushPromises()

    expect(computeSpy).toHaveBeenCalledTimes(2)

    // Resolve the OLDER call last -- its result must be discarded.
    resolveSecond({
      id: 'daily-closing', name: 'Daily Closing Report',
      dateRange: { from: '2026-08-18', to: '2026-08-18' }, generatedAt: '2026-08-18T00:00:00.000Z',
      sections: [{ type: 'summary', title: 'Newer Result', metrics: [], visibility: 'shop' }],
    })
    await flushPromises()
    resolveFirst({
      id: 'daily-closing', name: 'Daily Closing Report',
      dateRange: { from: '2026-08-18', to: '2026-08-18' }, generatedAt: '2026-08-18T00:00:00.000Z',
      sections: [{ type: 'summary', title: 'Older Result', metrics: [], visibility: 'shop' }],
    })
    await flushPromises()

    expect(wrapper.text()).toContain('Newer Result')
    expect(wrapper.text()).not.toContain('Older Result')
  })

  it('rejects an inverted date range with a visible error and never calls compute() (I9)', async () => {
    const vueRouter = await import('vue-router')
    vi.mocked(vueRouter.useRoute).mockReturnValue({ params: { reportId: 'daily-closing' } } as any)

    const computeSpy = vi.fn().mockResolvedValue({
      id: 'daily-closing', name: 'Daily Closing Report',
      dateRange: { from: '2026-08-18', to: '2026-08-18' }, generatedAt: '2026-08-18T00:00:00.000Z',
      sections: [{ type: 'summary', title: 'Totals', metrics: [], visibility: 'shop' }],
    })
    REPORT_DEFINITIONS['daily-closing'] = { id: 'daily-closing', name: 'Daily Closing Report', cadenceHint: 'daily', compute: computeSpy }

    const wrapper = mount(ReportDetailPage, { global: { mocks: { $router: createMockRouter() } } })
    await flushPromises()
    computeSpy.mockClear()

    await wrapper.find('[data-testid="range-from"]').setValue('2026-08-20')
    await wrapper.find('[data-testid="range-to"]').setValue('2026-08-10')
    await wrapper.find('[data-testid="regenerate-button"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="range-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="range-error"]').text()).toContain('يجب أن يكون تاريخ البداية قبل تاريخ النهاية أو مساويًا له')
    expect(computeSpy).not.toHaveBeenCalled()
  })
})
