import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createWebHistory } from 'vue-router'

vi.mock('@/store/device.store', () => ({
  useDeviceStore: () => ({ shopId: 'shop-1' }),
}))

const getOptional = vi.fn()
const execute = vi.fn()
vi.mock('@/data/powersync/db', () => ({
  db: { getOptional: (...args: any[]) => getOptional(...args), execute: (...args: any[]) => execute(...args) },
}))

import NotificationSettingsScreen from '../NotificationSettingsScreen.vue'

const router = createRouter({ history: createWebHistory(), routes: [{ path: '/', component: { template: '<div/>' } }] })

function mountIt() {
  return mount(NotificationSettingsScreen, {
    global: {
      plugins: [router],
      stubs: { AppHeader: true },
    },
  })
}

describe('NotificationSettingsScreen (WAFI-145 Task 18)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // No override rows -- every type resolves to its hardcoded default.
    getOptional.mockResolvedValue(undefined)
    execute.mockResolvedValue(undefined)
  })

  it('renders exactly 10 settings-bearing type rows, not 11', async () => {
    const wrapper = mountIt()
    await flushPromises()
    expect(wrapper.findAll('[data-testid^="notification-type-row-"]')).toHaveLength(10)
    expect(wrapper.find('[data-testid="notification-type-row-inventory.low_stock"]').exists()).toBe(false)
  })

  it('rejects open_time equal to close_time with a validation error', async () => {
    const wrapper = mountIt()
    await flushPromises()
    await wrapper.find('[data-testid="open-time-input"]').setValue('09:00')
    await wrapper.find('[data-testid="close-time-input"]').setValue('09:00')
    await wrapper.find('[data-testid="save-hours-button"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="hours-validation-error"]').exists()).toBe(true)
  })

  it('accepts an overnight schedule (open > close)', async () => {
    const wrapper = mountIt()
    await flushPromises()
    await wrapper.find('[data-testid="open-time-input"]').setValue('08:00')
    await wrapper.find('[data-testid="close-time-input"]').setValue('02:00')
    await wrapper.find('[data-testid="save-hours-button"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="hours-validation-error"]').exists()).toBe(false)
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('update shops'),
      ['08:00', '02:00', 0, 'shop-1'],
    )
  })

  it('sets open_time/close_time to null when 24/7 is enabled', async () => {
    const wrapper = mountIt()
    await flushPromises()
    await wrapper.find('[data-testid="is-24-7-checkbox"]').setValue(true)
    await wrapper.find('[data-testid="save-hours-button"]').trigger('click')
    await flushPromises()
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('update shops'),
      [null, null, 1, 'shop-1'],
    )
  })

  it('toggles a type on/off and persists it via a fresh insert (no existing row)', async () => {
    const wrapper = mountIt()
    await flushPromises()
    getOptional.mockClear()
    execute.mockClear()
    // No existing notification_settings row for this shop/type -> insert path.
    getOptional.mockResolvedValueOnce(undefined)
    await wrapper.find('[data-testid="enable-toggle-drawer.variance"]').setValue(false)
    await flushPromises()

    const [selectSql, selectParams] = getOptional.mock.calls[0]
    expect(selectSql.toLowerCase()).toContain('select id from notification_settings')
    expect(selectParams).toEqual(['shop-1', 'drawer.variance'])

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('insert into notification_settings'),
      [expect.any(String), 'shop-1', 'drawer.variance', 0, JSON.stringify({ type: 'drawer.variance', varianceUsdCap: 15 }), expect.any(String)],
    )
  })

  it('updates an existing notification_settings row via UPDATE, never ON CONFLICT', async () => {
    const wrapper = mountIt()
    await flushPromises()
    getOptional.mockClear()
    execute.mockClear()
    // Existing row found -> update path.
    getOptional.mockResolvedValueOnce({ id: 'row-1' })
    await wrapper.find('[data-testid="enable-toggle-drawer.variance"]').setValue(false)
    await flushPromises()

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('update notification_settings'),
      [0, JSON.stringify({ type: 'drawer.variance', varianceUsdCap: 15 }), expect.any(String), 'row-1'],
    )
    // PowerSync client tables are SQLite views over CRUD-queue triggers -- SQLite
    // rejects ON CONFLICT against a view, so this upsert MUST be read-then-write.
    for (const [sql] of execute.mock.calls) {
      expect(sql.toLowerCase()).not.toContain('on conflict')
    }
  })

  it('renders four enable-only rows with no threshold input', async () => {
    const wrapper = mountIt()
    await flushPromises()
    for (const type of ['expense.after_hours', 'staff.pin_locked_out', 'device.registered', 'settlement.paid']) {
      expect(wrapper.find(`[data-testid="threshold-input-${type}"]`).exists()).toBe(false)
    }
  })

  // WAFI-148A Task 13: the 8 new health-alert types get their own section and
  // their own Option-A "missing row = disabled, no default" read path
  // (getHealthAlertSetting), NOT the 10-type getNotificationSettings path
  // above (whose missing-row default is enabled=true, the opposite contract).
  describe('health-alert types (WAFI-148A Task 13)', () => {
    it('renders all 8 health-alert types in a distinct section', async () => {
      const wrapper = mountIt()
      await flushPromises()
      expect(wrapper.find('[data-testid="health-alerts-section"]').exists()).toBe(true)
      const healthTypes = [
        'health_alert_sync_failures',
        'health_alert_offline_duration',
        'health_alert_dead_letter_count',
        'health_alert_drawer_mismatches',
        'health_alert_deferred_job_failures',
        'health_alert_app_errors',
        'health_alert_stale_device',
        'health_alert_overdue_shift',
      ]
      for (const type of healthTypes) {
        expect(wrapper.find(`[data-testid="health-alert-type-row-${type}"]`).exists()).toBe(true)
      }
    })

    it('shows "not configured" (not a pre-filled default) when no row exists', async () => {
      // getOptional resolves undefined for every query (default beforeEach mock) --
      // no notification_settings row for any health-alert type.
      const wrapper = mountIt()
      await flushPromises()
      const row = wrapper.get('[data-testid="health-alert-type-row-health_alert_sync_failures"]')
      expect(row.find('[data-testid="health-not-configured-health_alert_sync_failures"]').exists()).toBe(true)
      expect((row.find('[data-testid="health-enable-toggle-health_alert_sync_failures"]').element as HTMLInputElement).checked).toBe(false)
      expect((row.find('[data-testid="health-threshold-input-health_alert_sync_failures"]').element as HTMLInputElement).value).toBe('')
    })

    it('prevents enabling without a threshold value', async () => {
      const wrapper = mountIt()
      await flushPromises()
      execute.mockClear()
      await wrapper.find('[data-testid="health-enable-toggle-health_alert_sync_failures"]').setValue(true)
      await flushPromises()
      expect(execute).not.toHaveBeenCalled()
      expect(wrapper.find('[data-testid="health-error-health_alert_sync_failures"]').exists()).toBe(true)
    })

    it('entering a threshold then enabling writes threshold_json as {"threshold": N} via the same write path', async () => {
      const wrapper = mountIt()
      await flushPromises()
      getOptional.mockClear()
      execute.mockClear()
      // No existing row -> insert path, same as the 10-type flow.
      getOptional.mockResolvedValueOnce(undefined)
      await wrapper.find('[data-testid="health-threshold-input-health_alert_sync_failures"]').setValue('5')
      await flushPromises()

      expect(execute).toHaveBeenCalledWith(
        expect.stringContaining('insert into notification_settings'),
        [expect.any(String), 'shop-1', 'health_alert_sync_failures', 0, JSON.stringify({ threshold: 5 }), expect.any(String)],
      )

      getOptional.mockClear()
      execute.mockClear()
      getOptional.mockResolvedValueOnce({ id: 'row-health-1' })
      await wrapper.find('[data-testid="health-enable-toggle-health_alert_sync_failures"]').setValue(true)
      await flushPromises()

      expect(execute).toHaveBeenCalledWith(
        expect.stringContaining('update notification_settings'),
        [1, JSON.stringify({ threshold: 5 }), expect.any(String), 'row-health-1'],
      )
    })
  })
})
