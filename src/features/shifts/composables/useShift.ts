import { db }             from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { useShiftStore }  from '@/features/shifts/shift.store'
import { useSessionStore } from '@/store/session.store'
import type { Staff }     from '@/features/staff/staff.types'
import { LONG_OPEN_HOURS } from '../shift.types'
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
  longOpenOnly?:   boolean         // WAFI-065: only shifts open past LONG_OPEN_HOURS
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

/**
 * Outcome of attempting to open a shift (WAFI-065 Part 1). `openShift` no longer
 * blindly inserts — exactly one open shift may exist per device:
 *  - `opened`   — no open shift existed; a fresh one was created.
 *  - `resumed`  — an open shift under the SAME operator already existed on this
 *                 device, so we re-attached to it instead of creating a duplicate
 *                 (the common zombie cause: a lost/cleared session, same person).
 *  - `conflict` — a DIFFERENT operator holds the device's open shift. No row is
 *                 created; the caller surfaces Story 5.3 (block / owner force-close).
 */
export type OpenShiftResult =
  | { status: 'opened';   shiftId: string }
  | { status: 'resumed';  shiftId: string }
  | { status: 'conflict'; shift: CashierShift }

/** What a force-close persists (WAFI-065 Part 2). Mirrors a normal close's evidence
 *  but is performed BY the owner on someone else's abandoned shift, so the actor is
 *  passed explicitly (the session operator may differ, or be unset at the login gate). */
export interface ForceCloseInput {
  shiftId:        string
  forcedBy:       Staff           // owner performing the force-close (recorded + audited)
  closingCashUsd: number
  closingCashSyp: number
  varianceUsd:    number
  varianceSyp:    number
  closeNote:      string
  zReport:        ZReportMetrics
}

export function useShift() {
  const { logShiftOpened, logShiftClosed, logShiftForceClosed } = useAuditLog()

  const device     = useDeviceStore()
  const shiftStore = useShiftStore()
  const session    = useSessionStore()

  /** The device's current open shift, if any. One query, reused by the open guard
   *  and the cold-start recovery in `loadActiveShift` (single source of truth). */
  async function findOpenShiftForDevice(): Promise<CashierShift | null> {
    const row = await db.getOptional<any>(
      `SELECT * FROM cashier_shifts
       WHERE shop_id = ? AND device_id = ? AND status = 'open'
       ORDER BY opened_at DESC LIMIT 1`,
      [device.shopId, device.deviceId]
    )
    return row ? rowToShift(row) : null
  }

  async function openShift(
    staff: Staff,
    openingCashUsd: number,
    openingCashSyp: number,
  ): Promise<OpenShiftResult> {
    // Guard: at most one open shift per device (WAFI-065 Part 1). The app-level
    // check is primary — offline-first can't rely on the DB partial unique index at
    // write time; the index (migration 026) is the backstop for anything that slips
    // through on sync/server.
    const existing = await findOpenShiftForDevice()
    if (existing) {
      if (existing.staffId === staff.id) {
        // Same operator returning to their own still-open shift → re-attach, never
        // create a second row. Re-establish identity for the existing shift.
        session.setActiveStaff(staff)
        shiftStore.openShift(existing.id, staff)
        return { status: 'resumed', shiftId: existing.id }
      }
      // A different operator already holds the device's open shift → do not open a
      // second. Caller surfaces Story 5.3 (notify non-owner / owner force-close).
      return { status: 'conflict', shift: existing }
    }

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
    return { status: 'opened', shiftId }
  }

  /** The single close write, shared by the normal close (WAFI-060) and the owner
   *  force-close (WAFI-065): both mark the shift closed and persist the same
   *  immutable evidence (counted cash, variance, note, force_closed_by, Z-report
   *  snapshot). Identity teardown + audit are the caller's job — they differ. */
  async function writeShiftClose(shiftId: string, e: {
    closingCashUsd: number
    closingCashSyp: number
    varianceUsd:    number | null
    varianceSyp:    number | null
    closeNote:      string | null
    forceClosedBy:  string | null
    zReport:        ZReportMetrics | null
  }): Promise<void> {
    await db.execute(
      `UPDATE cashier_shifts
       SET status = 'closed', closed_at = ?, closing_cash_usd = ?, closing_cash_syp = ?,
           variance_usd = ?, variance_syp = ?, close_note = ?, force_closed_by = ?,
           z_report_data = ?
       WHERE id = ?`,
      [
        new Date().toISOString(),
        e.closingCashUsd,
        e.closingCashSyp,
        e.varianceUsd,
        e.varianceSyp,
        e.closeNote,
        e.forceClosedBy,
        e.zReport ? JSON.stringify(e.zReport) : null,
        shiftId,
      ]
    )
  }

  /**
   * Owner force-close of an abandoned shift (WAFI-065 Part 2). Closes a SPECIFIC
   * shift by id with the same immutable evidence a normal close writes (variance +
   * note + Z-report snapshot), plus `force_closed_by` and a security audit entry —
   * never a silent fabricated count, so the figures stay trustworthy. Works offline:
   * the UPDATE + audit queue for sync like any other write.
   *
   * Crucially this does NOT clear the live session unless the shift being forced is
   * THIS device's active one — the owner force-closing a different/zombie shift must
   * keep their own session intact.
   */
  async function forceCloseShift(input: ForceCloseInput): Promise<void> {
    await writeShiftClose(input.shiftId, {
      closingCashUsd: input.closingCashUsd,
      closingCashSyp: input.closingCashSyp,
      varianceUsd:    input.varianceUsd,
      varianceSyp:    input.varianceSyp,
      closeNote:      input.closeNote,
      forceClosedBy:  input.forcedBy.id,
      zReport:        input.zReport,
    })
    // Only tear down local identity if we just closed the shift this device is
    // actively running; otherwise leave the current operator untouched.
    if (shiftStore.activeShiftId === input.shiftId) {
      shiftStore.closeShift()
      session.clearSession()
    }
    // Accountability event — surface a failed write (force-close IS the audit trail).
    await logShiftForceClosed(input.shiftId, input.forcedBy, input.closeNote)
  }

  async function closeShift(input: CloseShiftInput): Promise<void> {
    const shiftId = shiftStore.activeShiftId ?? input.shiftId
    if (!shiftId) throw new Error('No open shift to close')
    // Persist the variance + note + a full Z-report snapshot so the closed shift's
    // figures are immutable: reads (history, reprint) come back from this snapshot
    // and never recompute, so a later product/price/exchange-rate edit can't rewrite
    // a historical Z-report (WAFI-060).
    await writeShiftClose(shiftId, {
      closingCashUsd: input.closingCashUsd,
      closingCashSyp: input.closingCashSyp,
      varianceUsd:    input.varianceUsd ?? null,
      varianceSyp:    input.varianceSyp ?? null,
      closeNote:      input.closeNote ?? null,
      forceClosedBy:  input.forceClosedBy ?? null,
      zReport:        input.zReport ?? null,
    })
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
      return await findOpenShiftForDevice()
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
    // Long-open ("zombie") filter (WAFI-065 Part 3): still open AND opened before the
    // cutoff. The cutoff is computed here (not via SQLite datetime()) so the boundary
    // is explicit and matches the in-UI badge, which uses the same LONG_OPEN_HOURS.
    if (filters.longOpenOnly) {
      const cutoffIso = new Date(Date.now() - LONG_OPEN_HOURS * 3_600_000).toISOString()
      where.push("status = 'open' AND opened_at < ?")
      params.push(cutoffIso)
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
    forceCloseShift,
    findOpenShiftForDevice,
    loadActiveShift,
    loadLastClosedShift,
    loadShiftById,
    loadShiftHistory,
  }
}
