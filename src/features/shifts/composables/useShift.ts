import { db }             from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { useShiftStore }  from '@/features/shifts/shift.store'
import { useSessionStore } from '@/store/session.store'
import type { Staff }     from '@/features/staff/staff.types'
import type { CashierShift, ZReportMetrics } from '../shift.types'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'

/** Parse the stored Z-report JSON snapshot. Never throws — a corrupt/absent blob
 *  yields null so the UI falls back gracefully (live preview for an open shift). */
function parseZReport(raw: unknown): ZReportMetrics | null {
  if (typeof raw !== 'string' || raw.length === 0) return null
  try {
    return JSON.parse(raw) as ZReportMetrics
  } catch {
    return null
  }
}

function rowToShift(r: any): CashierShift {
  return {
    id:             r.id,
    shopId:         r.shop_id,
    deviceId:       r.device_id,
    staffId:        r.staff_id,
    openedAt:       r.opened_at,
    closedAt:       r.closed_at ?? null,
    openingCashUsd: r.opening_cash_usd,
    openingCashSyp: r.opening_cash_syp ?? 0,
    closingCashUsd: r.closing_cash_usd ?? null,
    closingCashSyp: r.closing_cash_syp ?? null,
    varianceUsd:    r.variance_usd ?? null,
    varianceSyp:    r.variance_syp ?? null,
    closeNote:      r.close_note ?? null,
    forceClosedBy:  r.force_closed_by ?? null,
    zReportData:    parseZReport(r.z_report_data),
    status:         r.status,
  }
}

/** Filters + paging for shift history (WAFI-061). All optional → "show all". */
export interface ShiftHistoryFilters {
  staffId?:        string | null
  startDate?:      string | null   // 'YYYY-MM-DD' inclusive, on opened_at
  endDate?:        string | null   // 'YYYY-MM-DD' inclusive, on opened_at
  varianceStatus?: 'any' | 'match' | 'variance'
  limit?:          number
  offset?:         number
}

export interface ShiftHistoryPage {
  shifts:  CashierShift[]
  hasMore: boolean         // true when more rows exist past this page
}

/** What close-shift persists: the counted cash plus the immutable evidence
 *  (variance per currency, the >5% note, the Z-report snapshot). WAFI-060. */
export interface CloseShiftInput {
  closingCashUsd: number
  closingCashSyp: number
  shiftId?:       string
  varianceUsd?:   number | null
  varianceSyp?:   number | null
  closeNote?:     string | null
  zReport?:       ZReportMetrics | null
  forceClosedBy?: string | null   // WAFI-065 force-close; null for a normal close
}

const DEFAULT_PAGE_SIZE = 25

export function useShift() {
  const { logShiftOpened, logShiftClosed } = useAuditLog()

  const device     = useDeviceStore()
  const shiftStore = useShiftStore()
  const session    = useSessionStore()

  async function openShift(
    staff: Staff,
    openingCashUsd: number,
    openingCashSyp: number,
  ): Promise<string> {
    const shiftId = crypto.randomUUID()
    const now     = new Date().toISOString()
    await db.execute(
      `INSERT INTO cashier_shifts
         (id, shop_id, device_id, staff_id, opened_at, opening_cash_usd, opening_cash_syp, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open')`,
      [shiftId, device.shopId, device.deviceId, staff.id, now, openingCashUsd, openingCashSyp]
    )
    // Identity lives in one place: opening a shift establishes who is using this
    // device. Set the session store BEFORE logging so the audit entry for the
    // shift-open action is attributed to this staff, not 'system'.
    session.setActiveStaff(staff)
    shiftStore.openShift(shiftId, staff)
    await logShiftOpened(shiftId)
    return shiftId
  }

  async function closeShift(input: CloseShiftInput): Promise<void> {
    const shiftId = shiftStore.activeShiftId ?? input.shiftId
    if (!shiftId) throw new Error('No open shift to close')
    const now = new Date().toISOString()
    // Persist the variance + note + a full Z-report snapshot so the closed shift's
    // figures are immutable: reads (history, reprint) come back from this snapshot
    // and never recompute, so a later product/price/exchange-rate edit can't rewrite
    // a historical Z-report (WAFI-060).
    await db.execute(
      `UPDATE cashier_shifts
       SET status = 'closed', closed_at = ?, closing_cash_usd = ?, closing_cash_syp = ?,
           variance_usd = ?, variance_syp = ?, close_note = ?, force_closed_by = ?,
           z_report_data = ?
       WHERE id = ?`,
      [
        now,
        input.closingCashUsd,
        input.closingCashSyp,
        input.varianceUsd ?? null,
        input.varianceSyp ?? null,
        input.closeNote ?? null,
        input.forceClosedBy ?? null,
        input.zReport ? JSON.stringify(input.zReport) : null,
        shiftId,
      ]
    )
    shiftStore.closeShift()
    // Log the close while identity is still set, then clear it so the two
    // identity stores fall back to null together (no stale session after logout).
    await logShiftClosed(shiftId)
    session.clearSession()
  }

  async function loadActiveShift(): Promise<CashierShift | null> {
    const shiftId = shiftStore.activeShiftId
    if (!shiftId) {
      // Recovery path: after refresh/restart, store state can be empty while an
      // open shift still exists in local DB for this device.
      const row = await db.getOptional<any>(
        `SELECT * FROM cashier_shifts
         WHERE shop_id = ? AND device_id = ? AND status = 'open'
         ORDER BY opened_at DESC LIMIT 1`,
        [device.shopId, device.deviceId]
      )
      return row ? rowToShift(row) : null
    }
    const row = await db.getOptional<any>(
      `SELECT * FROM cashier_shifts WHERE id = ?`,
      [shiftId]
    )
    if (!row || row.status !== 'open') {
      shiftStore.closeShift()
      return null
    }
    return rowToShift(row)
  }

  /** Most recent closed shift on this device — feeds the "last closed with X SYP +
   *  Y USD" hint on the open screen (WAFI-059). Null when none exists yet. */
  async function loadLastClosedShift(): Promise<CashierShift | null> {
    const row = await db.getOptional<any>(
      `SELECT * FROM cashier_shifts
       WHERE shop_id = ? AND device_id = ? AND status = 'closed'
       ORDER BY closed_at DESC LIMIT 1`,
      [device.shopId, device.deviceId]
    )
    return row ? rowToShift(row) : null
  }

  async function loadShiftById(shiftId: string): Promise<CashierShift | null> {
    const row = await db.getOptional<any>(
      `SELECT * FROM cashier_shifts WHERE id = ? AND shop_id = ?`,
      [shiftId, device.shopId]
    )
    return row ? rowToShift(row) : null
  }

  /**
   * Filtered, paginated shift history (WAFI-061). Replaces the old hardcoded
   * `LIMIT 50` (silent truncation) with explicit paging: we fetch limit+1 rows to
   * tell the caller whether more exist, so the UI can offer "load more" instead of
   * hiding older shifts.
   */
  async function loadShiftHistory(filters: ShiftHistoryFilters = {}): Promise<ShiftHistoryPage> {
    const limit  = filters.limit  ?? DEFAULT_PAGE_SIZE
    const offset = filters.offset ?? 0

    const where: string[]   = ['shop_id = ?']
    const params: unknown[] = [device.shopId]

    if (filters.staffId) {
      where.push('staff_id = ?')
      params.push(filters.staffId)
    }
    if (filters.startDate) {
      where.push('date(opened_at) >= ?')
      params.push(filters.startDate)
    }
    if (filters.endDate) {
      where.push('date(opened_at) <= ?')
      params.push(filters.endDate)
    }
    // Variance status reads the persisted variance (WAFI-060). COALESCE keeps
    // legacy/open shifts (null variance) out of the "variance" bucket.
    if (filters.varianceStatus === 'match') {
      where.push('(COALESCE(variance_usd, 0) = 0 AND COALESCE(variance_syp, 0) = 0)')
    } else if (filters.varianceStatus === 'variance') {
      where.push('(COALESCE(variance_usd, 0) <> 0 OR COALESCE(variance_syp, 0) <> 0)')
    }

    const result = await db.execute(
      `SELECT * FROM cashier_shifts
       WHERE ${where.join(' AND ')}
       ORDER BY opened_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit + 1, offset]
    )
    const rows: any[] = (result as any).rows._array
    const hasMore = rows.length > limit
    const shifts  = (hasMore ? rows.slice(0, limit) : rows).map(rowToShift)
    return { shifts, hasMore }
  }

  return {
    openShift,
    closeShift,
    loadActiveShift,
    loadLastClosedShift,
    loadShiftById,
    loadShiftHistory,
  }
}
