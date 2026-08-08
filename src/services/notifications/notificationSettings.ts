import { db } from '@/data/powersync/db'

// All 11 notification types that can produce a `notifications` row.
export type NotificationType =
  | 'discount.large_applied'
  | 'drawer.variance'
  | 'customer.debt_threshold'
  | 'inventory.low_stock'
  | 'shift.late_close'
  | 'expense.after_hours'
  | 'sale.large_return'
  | 'staff.pin_locked_out'
  | 'device.sync_stale'
  | 'device.registered'
  | 'settlement.paid'

// Only the types with shop-level settings (i.e. NOT 'inventory.low_stock', whose
// threshold lives on products.low_stock_threshold instead) appear here -- one row
// per shop per type in notification_settings, keyed by `type`. 11 notification
// types, 10 shop-level settings (WAFI-145 design spec).
export type SettingsBearingType = Exclude<NotificationType, 'inventory.low_stock'>

export type NotificationTypeSettings =
  | { type: 'discount.large_applied'; discountPercentCap: number }
  | { type: 'drawer.variance'; varianceUsdCap: number }
  | { type: 'customer.debt_threshold'; dailyDebtUsdCap: number }
  | { type: 'shift.late_close'; graceMinutes: number }
  | { type: 'sale.large_return'; refundUsdCap: number }
  | { type: 'device.sync_stale'; staleHours: number }
  | { type: 'expense.after_hours' }
  | { type: 'staff.pin_locked_out' }
  | { type: 'device.registered' }
  | { type: 'settlement.paid' }

export const DEFAULT_SETTINGS: Record<SettingsBearingType, NotificationTypeSettings> = {
  'discount.large_applied':  { type: 'discount.large_applied', discountPercentCap: 30 },
  'drawer.variance':         { type: 'drawer.variance', varianceUsdCap: 15 },
  'customer.debt_threshold': { type: 'customer.debt_threshold', dailyDebtUsdCap: 500 },
  'shift.late_close':        { type: 'shift.late_close', graceMinutes: 15 },
  'expense.after_hours':     { type: 'expense.after_hours' },
  'sale.large_return':       { type: 'sale.large_return', refundUsdCap: 100 },
  'staff.pin_locked_out':    { type: 'staff.pin_locked_out' },
  'device.sync_stale':       { type: 'device.sync_stale', staleHours: 2 },
  'device.registered':       { type: 'device.registered' },
  'settlement.paid':         { type: 'settlement.paid' },
}

interface SettingsRow { enabled: number; threshold_json: string | null }

/** Sparse-settings resolution (WAFI-145 design spec): a missing row resolves to
 *  the type's hardcoded default. Never throws -- a malformed threshold_json falls
 *  back to the default rather than blocking every notification of that type. */
export async function getNotificationSettings<T extends SettingsBearingType>(
  shopId: string,
  type: T,
): Promise<Extract<NotificationTypeSettings, { type: T }> & { enabled: boolean }> {
  const row = await db.getOptional<SettingsRow>(
    `select enabled, threshold_json from notification_settings where shop_id = ? and type = ?`,
    [shopId, type],
  )
  if (!row) return { ...DEFAULT_SETTINGS[type], enabled: true } as Extract<NotificationTypeSettings, { type: T }> & { enabled: boolean }

  let threshold: NotificationTypeSettings = DEFAULT_SETTINGS[type]
  if (row.threshold_json) {
    try {
      threshold = JSON.parse(row.threshold_json) as NotificationTypeSettings
    } catch {
      threshold = DEFAULT_SETTINGS[type]
    }
  }
  return { ...threshold, enabled: !!row.enabled } as Extract<NotificationTypeSettings, { type: T }> & { enabled: boolean }
}
