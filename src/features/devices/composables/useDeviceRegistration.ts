import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'

/**
 * Claims a device row for the current shop. Tries the server-allocated
 * permanent letter code (A/B/C...) first via the `allocate_device_code` RPC;
 * if that RPC is unreachable (offline first-run, or PowerSync hasn't synced
 * a connection yet), falls back to a locally-generated temporary `T-xxxx`
 * code so the device can keep working offline. The temp code is expected to
 * be reconciled to a permanent one once connectivity returns (later task).
 */
export function useDeviceRegistration() {
  async function registerDevice(shopId: string): Promise<{ code: string; isTemporary: boolean }> {
    try {
      const row = await db.getOptional<{ code: string }>(
        `SELECT public.allocate_device_code(?) AS code`, [shopId]
      )
      if (row?.code) {
        await db.execute(
          `INSERT INTO devices (id, shop_id, code, is_temporary, registered_at, sync_status)
           VALUES (?, ?, ?, ?, ?, 'pending')`,
          [uuidv4(), shopId, row.code, 0, new Date().toISOString()]
        )
        return { code: row.code, isTemporary: false }
      }
    } catch {
      // Offline or the allocator RPC is unreachable — fall through to a temp code.
    }

    const tempCode = `T-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
    await db.execute(
      `INSERT INTO devices (id, shop_id, code, is_temporary, registered_at, sync_status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [uuidv4(), shopId, tempCode, 1, new Date().toISOString()]
    )
    return { code: tempCode, isTemporary: true }
  }

  return { registerDevice }
}
