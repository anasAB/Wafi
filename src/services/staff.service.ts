import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { executeBusinessOperation } from '@/composables/executeBusinessOperation'
import { StaffEventType } from '@/services/events/domainEvent.types'
import type { StaffLedgerEntry, NewStaffLedgerEntry } from '@/features/staff-ledger/staff-ledger.types'
import type {
  StaffLedgerEntryAddedPayload, SettlementPaidPayload, ShiftOpenedPayload, ShiftClosedPayload,
} from '@/services/events/domainEvent.types'

/** Narrow audit interface this service needs — implemented by the caller via
 *  useAuditLog(), never imported here. */
export interface StaffLedgerAuditPort {
  logStaffLedgerEntryCreated: (
    entryId: string, staffId: string, entryType: string, amountUsd: number,
  ) => Promise<void>
}

export async function addLedgerEntry(
  shopId: string,
  createdByStaffId: string,
  entry: NewStaffLedgerEntry,
  _audit: StaffLedgerAuditPort,
): Promise<StaffLedgerEntry> {
  if (entry.amount <= 0) throw new Error('amount must be positive')
  if (entry.currency === 'syp' && !(entry.lockedRate! > 0)) {
    throw new Error('lockedRate is required and must be a positive rate when currency is syp')
  }
  const amountUsd = entry.currency === 'syp'
    ? Math.round((entry.amount / entry.lockedRate!) * 100) / 100
    : entry.amount

  if (amountUsd <= 0) {
    throw new Error('amount_usd must be positive after currency conversion')
  }

  const id = uuidv4()
  const clientOperationId = uuidv4()
  const now = new Date().toISOString()

  const write = async (): Promise<StaffLedgerEntry> => {
    await db.execute(
      `INSERT INTO staff_ledger
         (id, shop_id, staff_id, entry_type, amount_usd, currency_entered, locked_rate,
          note, source_type, source_id, created_by_staff_id, client_operation_id,
          settlement_id, created_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'pending')`,
      [
        id, shopId, entry.staffId, entry.entryType, amountUsd,
        entry.currency, entry.currency === 'syp' ? entry.lockedRate : null,
        entry.note ?? null, entry.sourceType ?? 'manual', entry.sourceId ?? null,
        createdByStaffId, clientOperationId, now,
      ],
    )
    return {
      id, shopId, staffId: entry.staffId, entryType: entry.entryType,
      amountUsd, currencyEntered: entry.currency,
      lockedRate: entry.currency === 'syp' ? entry.lockedRate! : null,
      note: entry.note ?? null, sourceType: entry.sourceType ?? 'manual',
      sourceId: entry.sourceId ?? null, createdByStaffId,
      clientOperationId, settlementId: null, createdAt: now,
    }
  }

  return executeBusinessOperation(write, {
    // WAFI-150: a staff ledger entry is now audited automatically by the
    // audit subscriber off staff.ledger_entry_added (see toEvent below).
    audit: async () => {},
    toEvent: (created) => ({
      type: StaffEventType.LedgerEntryAdded,
      entityId: created.id,
      payload: {
        staffId: created.staffId, entryType: created.entryType, amount: created.amountUsd,
      } satisfies StaffLedgerEntryAddedPayload,
      payloadVersion: 1,
      staffId: created.staffId,
      shopId,
      occurredAt: now,
    }),
  }, 'can_view_expenses')
}

/** Narrow audit interface this service needs — implemented by the caller via
 *  useAuditLog(), never imported here. */
export interface PaySettlementAuditPort {
  logStaffSettlementPaid: (settlementId: string, staffId: string, paymentMethod: string) => Promise<void>
}

export async function paySettlement(
  shopId: string,
  settlementId: string,
  staffId: string,
  paidByStaffId: string,
  paymentMethod: 'cash' | 'bank' | 'other',
  _audit: PaySettlementAuditPort,
): Promise<void> {
  const now = new Date().toISOString()

  const write = async (): Promise<void> => {
    await db.execute(
      `UPDATE staff_settlements SET status = 'paid', paid_at = ?, paid_by_staff_id = ?, payment_method = ? WHERE id = ?`,
      [now, paidByStaffId, paymentMethod, settlementId],
    )
  }

  await executeBusinessOperation(write, {
    // WAFI-150: a settlement payment is now audited automatically by the
    // audit subscriber off settlement.paid (see toEvent below).
    audit: async () => {},
    toEvent: () => ({
      type: StaffEventType.SettlementPaid,
      entityId: settlementId,
      payload: {
        staffId, amount: 0, ledgerBalanceAfter: 0,
      } satisfies SettlementPaidPayload,
      payloadVersion: 1,
      staffId,
      shopId,
      occurredAt: now,
    }),
  }, 'can_view_expenses')
}

// ── Shift open/close ────────────────────────────────────────────────────────
//
// NARROW EXTRACTION, deliberately not the whole of useShift.ts's openShift/
// closeShift: those functions are session/identity orchestration (the
// resume/conflict/device-deactivated decision tree, a network round-trip to
// establishOperatorIdentity(), and direct useSessionStore()/useShiftStore()
// mutations), not business-write logic comparable to this ticket's other 4
// services. Moving that orchestration into a framework-agnostic service would
// mean either breaking the "services never touch stores" rule for real, or
// inventing a callback-injection layer no other service in this ticket needs.
// So only the raw INSERT (brand-new shift) / UPDATE (normal close, and — as of
// WAFI-148 Task 5b — force close) writes are extracted here; useShift.ts keeps
// every session/store-mutating branch (identity teardown, shiftStore mutation),
// which still differs between the normal-close and force-close callers.

/** Narrow audit interface this service needs — implemented by the caller via
 *  useAuditLog(), never imported here. */
export interface OpenShiftAuditPort {
  logShiftOpened: (shiftId: string) => Promise<void>
}

export interface OpenShiftBreakdownInput {
  openingCashUsd: number
  openingCashSyp: number
  openingBreakdown: unknown
}

/** Inserts a brand-new open shift row. Callable only from useShift.ts's
 *  "no existing shift" branch — the resume/conflict paths never reach this,
 *  since they either resume an existing row (no insert) or return without
 *  writing anything. */
export async function openShift(
  shopId: string,
  deviceId: string,
  staffId: string,
  input: OpenShiftBreakdownInput,
  audit: OpenShiftAuditPort,
): Promise<{ id: string; openedAt: string }> {
  const shiftId = crypto.randomUUID()
  const now = new Date().toISOString()

  const write = async (): Promise<{ id: string; openedAt: string }> => {
    await db.execute(
      `INSERT INTO cashier_shifts
         (id, shop_id, device_id, staff_id, opened_at, opening_cash_usd, opening_cash_syp, opening_breakdown, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
      [
        shiftId, shopId, deviceId, staffId, now, input.openingCashUsd, input.openingCashSyp,
        input.openingBreakdown ? JSON.stringify(input.openingBreakdown) : null,
      ],
    )
    return { id: shiftId, openedAt: now }
  }

  return executeBusinessOperation(write, {
    audit: (shift) => audit.logShiftOpened(shift.id),
    toEvent: (shift) => ({
      type: StaffEventType.ShiftOpened,
      entityId: shift.id,
      payload: {
        shiftId: shift.id, staffId, openingCash: input.openingCashUsd,
      } satisfies ShiftOpenedPayload,
      payloadVersion: 1,
      staffId,
      shopId,
      occurredAt: now,
    }),
  })
}

/** Narrow audit interface this service needs — implemented by the caller via
 *  useAuditLog(), never imported here. */
export interface CloseShiftAuditPort {
  logShiftClosed: (shiftId: string) => Promise<void>
}

export interface CloseShiftWriteInput {
  closingCashUsd: number
  closingCashSyp: number
  varianceUsd: number | null
  varianceSyp: number | null
  closeNote: string | null
  zReport: unknown
  closingBreakdown: unknown
}

/** The normal-close UPDATE only (force_closed_by always null) — the force-close
 *  UPDATE (different actor/audit shape) is `forceCloseShift` below. */
export async function closeShift(
  shopId: string,
  shiftId: string,
  staffId: string,
  input: CloseShiftWriteInput,
  audit: CloseShiftAuditPort,
): Promise<void> {
  const now = new Date().toISOString()

  const write = async (): Promise<void> => {
    await db.execute(
      `UPDATE cashier_shifts
       SET status = 'closed', closed_at = ?, closing_cash_usd = ?, closing_cash_syp = ?,
           variance_usd = ?, variance_syp = ?, close_note = ?, force_closed_by = ?,
           z_report_data = ?, closing_breakdown = ?
       WHERE id = ?`,
      [
        now,
        input.closingCashUsd,
        input.closingCashSyp,
        input.varianceUsd,
        input.varianceSyp,
        input.closeNote,
        null,  // force_closed_by — always null on the normal-close path
        input.zReport ? JSON.stringify(input.zReport) : null,
        input.closingBreakdown ? JSON.stringify(input.closingBreakdown) : null,
        shiftId,
      ],
    )
  }

  await executeBusinessOperation(write, {
    audit: () => audit.logShiftClosed(shiftId),
    toEvent: () => ({
      type: StaffEventType.ShiftClosed,
      entityId: shiftId,
      payload: {
        shiftId, staffId,
        expectedCash: input.closingCashUsd - (input.varianceUsd ?? 0),
        countedCash: input.closingCashUsd,
        variance: input.varianceUsd ?? 0,
        forceClosedBy: null,  // always null on the normal-close path
      } satisfies ShiftClosedPayload,
      payloadVersion: 1,
      staffId,
      shopId,
      occurredAt: now,
    }),
  })
}

/** Narrow audit interface this service needs — implemented by the caller via
 *  useAuditLog(), never imported here. */
export interface ForceCloseShiftAuditPort {
  logShiftForceClosed: (shiftId: string) => Promise<void>
}

export interface ForceCloseShiftWriteInput {
  closingCashUsd: number
  closingCashSyp: number
  varianceUsd: number | null
  varianceSyp: number | null
  closeNote: string | null
  zReport: unknown
  closingBreakdown: unknown
  forcedByStaffId: string
}

/** The force-close UPDATE + event publish (WAFI-065 owner force-close, wired to the
 *  event bus by WAFI-148 Task 5b — previously this path never published any event at
 *  all, which meant WAFI-148's never_closed_shift_count metric could never fire). */
export async function forceCloseShift(
  shopId: string,
  shiftId: string,
  staffId: string,
  input: ForceCloseShiftWriteInput,
  audit: ForceCloseShiftAuditPort,
): Promise<void> {
  const now = new Date().toISOString()

  const write = async (): Promise<void> => {
    await db.execute(
      `UPDATE cashier_shifts
       SET status = 'closed', closed_at = ?, closing_cash_usd = ?, closing_cash_syp = ?,
           variance_usd = ?, variance_syp = ?, close_note = ?, force_closed_by = ?,
           z_report_data = ?, closing_breakdown = ?
       WHERE id = ?`,
      [
        now,
        input.closingCashUsd,
        input.closingCashSyp,
        input.varianceUsd,
        input.varianceSyp,
        input.closeNote,
        input.forcedByStaffId,
        input.zReport ? JSON.stringify(input.zReport) : null,
        input.closingBreakdown ? JSON.stringify(input.closingBreakdown) : null,
        shiftId,
      ],
    )
  }

  await executeBusinessOperation(write, {
    audit: () => audit.logShiftForceClosed(shiftId),
    toEvent: () => ({
      type: StaffEventType.ShiftClosed,
      entityId: shiftId,
      payload: {
        shiftId, staffId,
        expectedCash: input.closingCashUsd - (input.varianceUsd ?? 0),
        countedCash: input.closingCashUsd,
        variance: input.varianceUsd ?? 0,
        forceClosedBy: input.forcedByStaffId,
      } satisfies ShiftClosedPayload,
      payloadVersion: 1,
      staffId,
      shopId,
      occurredAt: now,
    }),
  })
}
