import { describe, it, expect, vi, beforeEach } from 'vitest'

const getOptional = vi.fn()
vi.mock('@/data/powersync/db', () => ({
  db: { getOptional: (...args: any[]) => getOptional(...args) },
}))

import { getHealthAlertSetting } from '../healthAlertSettings'
import { HEALTH_ALERT_SYNC_FAILURES } from '../healthAlertTypes'

describe('getHealthAlertSetting (WAFI-148A Task 13)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves a missing row to { enabled: false, threshold: null } -- NOT a default, unlike getNotificationSettings', async () => {
    getOptional.mockResolvedValue(undefined)
    const result = await getHealthAlertSetting('shop-1', HEALTH_ALERT_SYNC_FAILURES)
    expect(result).toEqual({ enabled: false, threshold: null })
  })

  it('reads enabled + threshold from an existing row', async () => {
    getOptional.mockResolvedValue({ enabled: 1, threshold_json: JSON.stringify({ threshold: 7 }) })
    const result = await getHealthAlertSetting('shop-1', HEALTH_ALERT_SYNC_FAILURES)
    expect(result).toEqual({ enabled: true, threshold: 7 })
  })

  it('treats a disabled row as enabled: false while still surfacing its stored threshold', async () => {
    getOptional.mockResolvedValue({ enabled: 0, threshold_json: JSON.stringify({ threshold: 3 }) })
    const result = await getHealthAlertSetting('shop-1', HEALTH_ALERT_SYNC_FAILURES)
    expect(result).toEqual({ enabled: false, threshold: 3 })
  })

  it('resolves malformed threshold_json to threshold: null rather than throwing or defaulting', async () => {
    getOptional.mockResolvedValue({ enabled: 1, threshold_json: 'not json' })
    const result = await getHealthAlertSetting('shop-1', HEALTH_ALERT_SYNC_FAILURES)
    expect(result).toEqual({ enabled: true, threshold: null })
  })

  it('resolves a non-numeric threshold field to threshold: null', async () => {
    getOptional.mockResolvedValue({ enabled: 1, threshold_json: JSON.stringify({ threshold: 'five' }) })
    const result = await getHealthAlertSetting('shop-1', HEALTH_ALERT_SYNC_FAILURES)
    expect(result).toEqual({ enabled: true, threshold: null })
  })

  it('resolves a null threshold_json to threshold: null', async () => {
    getOptional.mockResolvedValue({ enabled: 1, threshold_json: null })
    const result = await getHealthAlertSetting('shop-1', HEALTH_ALERT_SYNC_FAILURES)
    expect(result).toEqual({ enabled: true, threshold: null })
  })
})
