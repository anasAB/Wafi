import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { setActivePinia, createPinia } from 'pinia'
import ReportDetailPage from '../ReportDetailPage.vue'

// Final-review C4: tryLoadSnapshot() now (1) only queries the DB at all when
// the picker's current range equals the cadence's canonical "most recently
// completed period" (computed via expectedPeriodUtc, never a raw
// range.to-only guess), and (2) queries generated_reports by shop_id +
// report_type only -- never an exact-string match against the synced
// period_start/period_end columns -- then verifies the returned row's own
// period as parsed Date objects before trusting it. These tests assert that
// actual query behavior (what is/isn't passed to db.getOptional, and when
// it is/isn't called at all), not an unconditional mock return.

vi.mock('@/data/powersync/db', () => ({
  db: {
    getOptional: vi.fn(),
    getAll: vi.fn().mockResolvedValue([]),
  },
}))
vi.mock('@/store/device.store', () => ({ useDeviceStore: () => ({ shopId: 'shop1' }) }))

async function mountAt(reportId: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/reports/:reportId', component: ReportDetailPage }] })
  await router.push(`/reports/${reportId}`)
  return mount(ReportDetailPage, { global: { plugins: [router] } })
}

describe('ReportDetailPage snapshot-first read path', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('skips the snapshot query entirely when the picker holds the cadence default rolling range (never the canonical scheduled period)', async () => {
    const { db } = await import('@/data/powersync/db')
    // cash-flow's default range is {from: today, to: today} (defaultRangeForCadence's
    // daily branch), which never equals the canonical period [yesterday, today)
    // expectedPeriodUtc derives for "now" -- so tryLoadSnapshot must bail out
    // BEFORE ever calling db.getOptional.
    vi.setSystemTime(new Date('2026-08-20T12:00:00Z'))

    const wrapper = await mountAt('cash-flow')
    await new Promise((r) => setTimeout(r, 0))

    expect(db.getOptional).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="snapshot-generated-at"]').exists()).toBe(false)
  })

  it('queries by shop_id + report_type only (no exact-string period match) once the picker range is set to the canonical period', async () => {
    const { db } = await import('@/data/powersync/db')
    vi.setSystemTime(new Date('2026-08-20T12:00:00Z'))
    // The canonical daily period as of 2026-08-20T12:00:00Z is
    // [2026-08-19T00:00:00Z, 2026-08-20T00:00:00Z) -> local range 2026-08-19..2026-08-19.
    vi.mocked(db.getOptional).mockResolvedValueOnce({
      id: 'snap-1',
      report_data: JSON.stringify({
        id: 'cash-flow', name: 'Cash Flow Report', dateRange: { from: '2026-08-19', to: '2026-08-19' },
        sections: [{ type: 'summary', title: 'Cash Flow', visibility: 'shop', metrics: [] }],
      }),
      generated_at: '2026-08-20T00:01:00.000Z',
      scheduled_for: '2026-08-20T00:00:00.000Z',
      period_start: '2026-08-19T00:00:00.000Z',
      period_end: '2026-08-20T00:00:00.000Z',
    })

    const wrapper = await mountAt('cash-flow')
    await wrapper.find('[data-testid="range-from"]').setValue('2026-08-19')
    await wrapper.find('[data-testid="range-to"]').setValue('2026-08-19')
    await wrapper.find('[data-testid="regenerate-button"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(db.getOptional).toHaveBeenCalledWith(
      expect.stringContaining('WHERE shop_id = ? AND report_type = ?'),
      ['shop1', 'cash-flow'],
    )
    expect(wrapper.find('[data-testid="snapshot-generated-at"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="snapshot-period"]').text()).toContain('2026-08-19')
  })

  it('rejects the returned row and falls back to live compute() when its actual period does not match the expected period', async () => {
    const { db } = await import('@/data/powersync/db')
    vi.setSystemTime(new Date('2026-08-20T12:00:00Z'))
    // Row exists for this shop_id/report_type, but its period is a DIFFERENT
    // day than the one the picker's range (matched to the canonical period)
    // expects -- must be rejected by the Date-object comparison, not trusted
    // just because a row came back.
    vi.mocked(db.getOptional).mockResolvedValueOnce({
      id: 'snap-stale',
      report_data: JSON.stringify({
        id: 'cash-flow', name: 'Cash Flow Report', dateRange: { from: '2026-08-01', to: '2026-08-01' },
        sections: [{ type: 'summary', title: 'Cash Flow', visibility: 'shop', metrics: [] }],
      }),
      generated_at: '2026-08-01T00:01:00.000Z',
      scheduled_for: '2026-08-01T00:00:00.000Z',
      period_start: '2026-08-01T00:00:00.000Z',
      period_end: '2026-08-02T00:00:00.000Z',
    })

    const wrapper = await mountAt('cash-flow')
    await wrapper.find('[data-testid="range-from"]').setValue('2026-08-19')
    await wrapper.find('[data-testid="range-to"]').setValue('2026-08-19')
    await wrapper.find('[data-testid="regenerate-button"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(db.getOptional).toHaveBeenCalled()
    expect(wrapper.find('[data-testid="snapshot-generated-at"]').exists()).toBe(false)
  })

  it('falls back to live compute() with no generated-at display when no snapshot row exists at all', async () => {
    const { db } = await import('@/data/powersync/db')
    vi.setSystemTime(new Date('2026-08-20T12:00:00Z'))
    vi.mocked(db.getOptional).mockResolvedValueOnce(undefined)

    const wrapper = await mountAt('cash-flow')
    await wrapper.find('[data-testid="range-from"]').setValue('2026-08-19')
    await wrapper.find('[data-testid="range-to"]').setValue('2026-08-19')
    await wrapper.find('[data-testid="regenerate-button"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(wrapper.find('[data-testid="snapshot-generated-at"]').exists()).toBe(false)
  })
})
