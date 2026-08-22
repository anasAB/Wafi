// src/features/health/alerting/healthAlertSettings.ts
//
// WAFI-148A Task 13: read/write path for the 8 health-alert types' shop-level
// settings, SEPARATE from src/services/notifications/notificationSettings.ts's
// getNotificationSettings.
//
// Why a separate function instead of adding these 8 types to
// getNotificationSettings/DEFAULT_SETTINGS/SettingsBearingType: that function's
// "sparse-settings resolution" (WAFI-145 design spec) deliberately resolves a
// MISSING notification_settings row to `enabled: true` plus a hardcoded default
// threshold -- correct for the original 10 notification types, but the EXACT
// OPPOSITE of what every server-side evaluator built in Tasks 5-11 (migrations
// 119/120/122) implements for these 8 new health_alert_* types: "Option A" --
// missing row, disabled row, or invalid/missing threshold_json all mean "skip
// entirely, no default threshold, alert type is off until explicitly
// configured." Gate 2 (no product-approved default thresholds exist yet)
// forbids inventing a default at runtime anywhere in this feature, including
// here. Reusing getNotificationSettings for these 8 types would silently
// display them as "enabled" with an invented threshold the instant a shop has
// no row -- the opposite of the contract every evaluator relies on.
//
// This is the same table (notification_settings) and the same client-side
// PowerSync-synced `db.getOptional` query pattern as getNotificationSettings --
// only the missing-row resolution differs.

import { db } from '@/data/powersync/db'
import type { HealthAlertType } from './healthAlertTypes'

export interface HealthAlertSetting {
  enabled: boolean
  threshold: number | null
}

interface SettingsRow {
  enabled: number
  threshold_json: string | null
}

/** Missing row -> `{ enabled: false, threshold: null }`, NOT a default --
 *  matches the server-side Option-A contract exactly. Never throws: a
 *  malformed/non-numeric `threshold_json.threshold` resolves to `threshold:
 *  null` (same "invalid config -> treat as not configured" stance the
 *  evaluators take, though they also RAISE WARNING server-side). */
export async function getHealthAlertSetting(
  shopId: string,
  type: HealthAlertType,
): Promise<HealthAlertSetting> {
  const row = await db.getOptional<SettingsRow>(
    `select enabled, threshold_json from notification_settings where shop_id = ? and type = ?`,
    [shopId, type],
  )
  if (!row) return { enabled: false, threshold: null }

  let threshold: number | null = null
  if (row.threshold_json) {
    try {
      const parsed = JSON.parse(row.threshold_json) as { threshold?: unknown }
      threshold = typeof parsed.threshold === 'number' && Number.isFinite(parsed.threshold)
        ? parsed.threshold
        : null
    } catch {
      threshold = null
    }
  }
  return { enabled: !!row.enabled, threshold }
}
