// State-derived Sync Failure check (WAFI-145 design spec). No background timer
// exists in this offline-first PWA -- run on app foreground only (App.vue wiring
// on mount + document visibilitychange -> 'visible'), not a periodic in-app timer.
// A device is never stale relative to itself (self-exclusion via currentDeviceId).
//
// No source_event_id (this isn't event-sourced) -- migration 080 made that column
// nullable specifically for this case, same pattern as lowStockCheck.ts's Task 13.

import { db } from '@/data/powersync/db'
import { getNotificationSettings } from '@/services/notifications/notificationSettings'

interface DeviceRow { id: string; last_seen_at: string | null }

export async function checkDeviceSyncStaleness(shopId: string, currentDeviceId: string): Promise<void> {
  const settings = await getNotificationSettings(shopId, 'device.sync_stale')
  if (!settings.enabled) return

  const devices = await db.getAll<DeviceRow>(
    `select id, last_seen_at from devices where shop_id = ? and (is_active is null or is_active = 1)`,
    [shopId],
  )
  const staleMs = settings.staleHours * 60 * 60 * 1000
  const now = Date.now()

  for (const device of devices) {
    if (device.id === currentDeviceId) continue // a device is never stale relative to itself
    if (!device.last_seen_at) continue
    const staleFor = now - new Date(device.last_seen_at).getTime()
    if (staleFor <= staleMs) continue

    // "Not already notified for this staleness episode": one notification per
    // device per day is enough signal without a generic rate limiter. Dedup is
    // per-device (shop + type + entity_id + day), not just shop+type, since
    // multiple devices can be independently stale at once.
    const today = new Date(now).toISOString().slice(0, 10)
    const existing = await db.getOptional<{ id: string }>(
      `select id from notifications where shop_id = ? and type = 'device.sync_stale'
       and entity_id = ? and substr(created_at, 1, 10) = ?`,
      [shopId, device.id, today],
    )
    if (existing) continue

    await db.execute(
      `insert into notifications (id, shop_id, recipient_role, type, title, message, entity_type, entity_id, severity, source_event_id, created_at)
       values (?, ?, 'owner', 'device.sync_stale', ?, ?, 'device', ?, 'INFO', NULL, ?)`,
      [
        crypto.randomUUID(), shopId,
        'جهاز لم يُزامن',
        `لم يقم أحد الأجهزة بالمزامنة منذ أكثر من ${settings.staleHours} ساعة`,
        device.id, new Date(now).toISOString(),
      ],
    )
  }
}
