import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { supabase } from '@/data/supabase/client'
import { publishEvent } from '@/services/events/publishEvent'
import { useSessionStore } from '@/store/session.store'
import { DeviceEventType, type DeviceRegisteredPayload } from '@/services/events/domainEvent.types'

/**
 * Claims a device row for the current shop. Tries the server-allocated
 * permanent letter code (A/B/C...) first via the `register_device` RPC — a
 * SECURITY DEFINER function (migration 072) that creates the `devices` row
 * directly, bypassing `devices`' owner-only INSERT RLS
 * (055_identity_domain_rls.sql). This must NOT be a plain client-side INSERT:
 * `switch_active_operator()` requires the device row to already exist before
 * `active_role` can become `'owner'`, so gating this on role (or on RLS,
 * which amounts to the same thing) is a circular dependency that permanently
 * blocks login on a fresh device — found live 2026-07-29, see 072's own
 * comment for the full incident.
 *
 * If the RPC is unreachable (offline first-run, or PowerSync hasn't synced a
 * connection yet), falls back to a locally-generated temporary `T-xxxx` code
 * so the device can keep working offline. The temp code is expected to be
 * reconciled to a permanent one once connectivity returns (later task).
 *
 * Returns the actual `devices.id` this call registered (or generated for the
 * temp-code fallback) — the caller must adopt THIS id, not one it generated
 * itself, or the two diverge and every later `switch_active_operator` call
 * looks up a device that doesn't exist (found live 2026-07-29 alongside the
 * RLS issue above).
 */
export function useDeviceRegistration() {
  async function registerDevice(shopId: string): Promise<{ id: string; code: string; isTemporary: boolean }> {
    const id = uuidv4()

    function publishRegistered(result: { id: string; code: string; isTemporary: boolean }) {
      // Bespoke publish (WAFI-140 Sprint 2 design spec §5): registerDevice is an RPC call +
      // local insert, not a local-write-then-audit pair -- it intentionally bypasses
      // executeBusinessOperation, which has no RPC-aware variant today.
      void publishEvent<DeviceRegisteredPayload>({
        type: DeviceEventType.Registered,
        entityId: result.id,
        payload: { deviceId: result.id, deviceCode: result.code, isTemporary: result.isTemporary },
        payloadVersion: 1,
        // First-run bootstrap has no staff row yet -- '' is a documented, pre-existing-shape
        // gap (mirrors paySettlement's shopId: '' from Sprint 1), not silently swallowed.
        staffId: useSessionStore().activeStaff?.id ?? '',
        shopId,
        occurredAt: new Date().toISOString(),
      }).catch(() => {})
      return result
    }

    try {
      const { data: code, error } = await supabase.rpc('register_device', { p_device_id: id })
      if (error) throw error
      if (code) return publishRegistered({ id, code, isTemporary: false })
      // code is null: auth_shop_id() resolved to NULL server-side (not
      // actually offline — a real, if unexpected, state) — fall through to
      // the temp-code path the same way an unreachable RPC would.
    } catch {
      // Offline or the RPC is unreachable — fall through to a temp code.
    }

    const tempCode = `T-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
    await db.execute(
      `INSERT INTO devices (id, shop_id, code, is_temporary, registered_at, sync_status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [id, shopId, tempCode, 1, new Date().toISOString()]
    )
    return publishRegistered({ id, code: tempCode, isTemporary: true })
  }

  return { registerDevice }
}
