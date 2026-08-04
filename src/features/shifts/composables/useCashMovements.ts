import { db }              from '@/data/powersync/db'
import { useDeviceStore }  from '@/store/device.store'
import { useSessionStore } from '@/store/session.store'
import { useAuditLog }     from '@/features/audit/composables/useAuditLog'
import { executeBusinessOperation } from '@/composables/executeBusinessOperation'
import { CashEventType, type CashMovementRecordedPayload } from '@/services/events/domainEvent.types'
import { useZReport }      from './useZReport'
import type { CashierShift } from '../shift.types'
import type {
  CashMovement, CashMovementCategory, CashMovementDirection, CashCurrency,
} from '../cashMovement.types'

export interface RecordCashMovementInput {
  shift:     CashierShift
  direction: CashMovementDirection
  category:  CashMovementCategory
  currency:  CashCurrency
  amount:    number
  note?:     string | null
}

function rowToMovement(r: any): CashMovement {
  return {
    id:              r.id,
    shopId:          r.shop_id,
    deviceId:        r.device_id,
    shiftId:         r.shift_id,
    staffId:         r.staff_id ?? null,
    direction:       r.direction,
    category:        r.category,
    currency:        r.currency,
    amount:          r.amount,
    note:            r.note ?? null,
    voidsMovementId: r.voids_movement_id ?? null,
    createdAt:       r.created_at,
  }
}

export function useCashMovements() {
  const device  = useDeviceStore()
  const session = useSessionStore()
  const { logCashMovementRecorded, logCashMovementVoided } = useAuditLog()

  async function insert(m: {
    shiftId: string; direction: CashMovementDirection; category: CashMovementCategory
    currency: CashCurrency; amount: number; note: string | null; voidsMovementId: string | null
  }): Promise<string> {
    const id  = crypto.randomUUID()
    const now = new Date().toISOString()
    await db.execute(
      `INSERT INTO cash_movements
         (id, shop_id, device_id, shift_id, staff_id, direction, category, currency,
          amount, note, voids_movement_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, device.shopId, device.deviceId, m.shiftId, session.activeStaff?.id ?? null,
       m.direction, m.category, m.currency, m.amount, m.note, m.voidsMovementId, now],
    )
    return id
  }

  async function record(input: RecordCashMovementInput): Promise<string> {
    if (input.shift.status !== 'open') {
      throw new Error('لا يمكن تسجيل حركة نقدية على وردية غير مفتوحة')
    }
    if (!(input.amount > 0)) {
      throw new Error('المبلغ يجب أن يكون أكبر من صفر')
    }
    if (input.currency === 'SYP' && !Number.isInteger(input.amount)) {
      throw new Error('مبلغ الليرة يجب أن يكون رقماً صحيحاً')
    }
    return executeBusinessOperation(
      () => insert({
        shiftId: input.shift.id, direction: input.direction, category: input.category,
        currency: input.currency, amount: input.amount, note: input.note ?? null,
        voidsMovementId: null,
      }),
      {
        audit: (id) => logCashMovementRecorded(id, input.direction, input.category, input.currency, input.amount),
        toEvent: (id) => ({
          type: CashEventType.MovementRecorded,
          entityId: id,
          payload: {
            movementId: id, shiftId: input.shift.id,
            direction: input.direction, category: input.category, currency: input.currency,
            amountUsd: input.amount,
          } satisfies CashMovementRecordedPayload,
          payloadVersion: 1,
          staffId: session.activeStaff?.id ?? '',
          shopId: device.shopId,
          occurredAt: new Date().toISOString(),
        }),
      },
    )
  }

  async function voidMovement(movementId: string, reasonNote: string): Promise<string> {
    const orig = await db.getOptional<any>(
      `SELECT * FROM cash_movements WHERE id = ? AND shop_id = ?`,
      [movementId, device.shopId],
    )
    if (!orig) throw new Error('الحركة غير موجودة')
    if (orig.voids_movement_id) throw new Error('لا يمكن عكس حركة عكسية')
    const existingVoid = await db.getOptional<any>(
      `SELECT id FROM cash_movements WHERE voids_movement_id = ? AND shop_id = ?`,
      [movementId, device.shopId],
    )
    if (existingVoid) throw new Error('تم عكس هذه الحركة مسبقاً')

    const reverseDir: CashMovementDirection = orig.direction === 'in' ? 'out' : 'in'
    return executeBusinessOperation(
      () => insert({
        shiftId: orig.shift_id, direction: reverseDir, category: orig.category,
        currency: orig.currency, amount: orig.amount, note: reasonNote ?? null,
        voidsMovementId: movementId,
      }),
      { audit: (id) => logCashMovementVoided(id, movementId, reasonNote ?? '') },
    )
  }

  async function listForShift(shiftId: string): Promise<CashMovement[]> {
    const rows = await db.getAll<any>(
      `SELECT * FROM cash_movements WHERE shop_id = ? AND shift_id = ? ORDER BY created_at ASC`,
      [device.shopId, shiftId],
    )
    return rows.map(rowToMovement)
  }

  // The drawer's expected cash right now = the Z-report's `expected*` with a zero
  // count. Reuses the verified reconciliation engine (which already includes this
  // shift's movements via the Z-report query) — no duplicate SQL, no second source
  // of truth.
  async function liveDrawer(shift: CashierShift): Promise<{ expectedUsd: number; expectedSyp: number }> {
    const { compute } = useZReport()
    const m = await compute(shift, 0, 0)
    return { expectedUsd: m.expectedUsd, expectedSyp: m.expectedSyp }
  }

  return { record, voidMovement, listForShift, liveDrawer }
}
