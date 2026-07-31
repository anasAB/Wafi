import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { useSessionStore } from '@/store/session.store'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'
import { executeBusinessOperation } from '@/composables/executeBusinessOperation'
import { paySettlement as paySettlementService } from '@/services/staff.service'
import type { StaffSettlement, StaffLedgerEntry } from '@/features/staff-ledger/staff-ledger.types'

type StaffLedgerRowLocal = { id: string; entry_type: string; amount_usd: number }

interface FinalizeOptions {
  settlementCurrency: 'usd' | 'syp'
  baseSalaryUsd: number
  notes: string | null
  applications: Array<{ ledgerEntryId: string; applyAmountUsd: number }>
  settlementRate?: number // required if settlementCurrency = 'syp'
}

export type StaffSettlementRow = {
  id: string; shop_id: string; staff_id: string; settlement_number: string
  period_month: string; status: string; base_salary_usd: number | null
  settlement_currency: 'usd' | 'syp' | null; locked_rate: number | null
  applied_amount_usd: number | null; final_amount_usd: number | null
  notes: string | null; staff_name_snapshot: string | null; staff_role_snapshot: string | null
  finalized_at: string | null; paid_at: string | null; paid_by_staff_id: string | null
  payment_method: string | null; client_operation_id: string; created_at: string
}

export function rowToSettlement(r: StaffSettlementRow): StaffSettlement {
  return {
    id: r.id, shopId: r.shop_id, staffId: r.staff_id, settlementNumber: r.settlement_number,
    periodMonth: r.period_month, status: r.status as StaffSettlement['status'],
    baseSalaryUsd: r.base_salary_usd, settlementCurrency: r.settlement_currency,
    lockedRate: r.locked_rate, appliedAmountUsd: r.applied_amount_usd,
    finalAmountUsd: r.final_amount_usd, notes: r.notes,
    staffNameSnapshot: r.staff_name_snapshot, staffRoleSnapshot: r.staff_role_snapshot,
    finalizedAt: r.finalized_at, paidAt: r.paid_at, paidByStaffId: r.paid_by_staff_id,
    paymentMethod: r.payment_method as StaffSettlement['paymentMethod'],
    clientOperationId: r.client_operation_id, createdAt: r.created_at,
  }
}

export function useStaffSettlement() {
  const { logStaffSettlementFinalized, logStaffSettlementPaid } = useAuditLog()

  async function createDraft(
    staffId: string, periodMonth: string,
  ): Promise<{ settlement: StaffSettlement; resumed: boolean }> {
    const device = useDeviceStore()
    const existing = await db.getOptional<StaffSettlementRow>(
      `SELECT * FROM staff_settlements WHERE shop_id = ? AND staff_id = ? AND period_month = ? AND status = 'draft'`,
      [device.shopId, staffId, periodMonth],
    )
    if (existing) return { settlement: rowToSettlement(existing), resumed: true }

    const id = uuidv4()
    const clientOperationId = uuidv4()
    const now = new Date().toISOString()
    // Settlement number: {YYYYMM}-{last 6 chars of id, uppercased} — a display
    // convenience, not a uniqueness key (period_month + staff_id is), so a rare
    // collision is cosmetic only.
    const settlementNumber = `${periodMonth.slice(0, 7).replace('-', '')}-${id.slice(-6).toUpperCase()}`

    await db.execute(
      `INSERT INTO staff_settlements
         (id, shop_id, staff_id, settlement_number, period_month, status, client_operation_id, created_at, sync_status)
       VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, 'pending')`,
      [id, device.shopId, staffId, settlementNumber, periodMonth, clientOperationId, now],
    )

    return {
      settlement: rowToSettlement({
        id, shop_id: device.shopId, staff_id: staffId, settlement_number: settlementNumber,
        period_month: periodMonth, status: 'draft', base_salary_usd: null,
        settlement_currency: null, locked_rate: null, applied_amount_usd: null,
        final_amount_usd: null, notes: null, staff_name_snapshot: null, staff_role_snapshot: null,
        finalized_at: null, paid_at: null, paid_by_staff_id: null, payment_method: null,
        client_operation_id: clientOperationId, created_at: now,
      }),
      resumed: false,
    }
  }

  /**
   * Pure calculation, no DB access — the UI calls this on every toggle/amount
   * edit to show the running total before Finalize. finalize() (Task 8)
   * re-validates and re-applies this same math against fresh data server-side,
   * since UI-computed state must never be trusted at commit time.
   */
  function applyLedgerEntry(
    entry: StaffLedgerEntry,
    applyAmountUsd: number,
  ): { appliedAmountUsd: number; carryForwardAmountUsd: number } {
    if (applyAmountUsd > entry.amountUsd) {
      throw new Error(`apply amount ${applyAmountUsd} exceeds entry remaining amount ${entry.amountUsd}`)
    }
    return {
      appliedAmountUsd: applyAmountUsd,
      carryForwardAmountUsd: Math.round((entry.amountUsd - applyAmountUsd) * 100) / 100,
    }
  }

  /**
   * Transactional month-end settlement finalization (WAFI-138 Invariant 10).
   * Re-reads outstanding ledger rows fresh from the DB — never trusts
   * UI-computed totals — re-validates every applied amount against the
   * row's actual remaining amount, then inside a single db.writeTransaction:
   * links consumed rows to the settlement (Invariant 2 — the only place
   * settlement_id is ever set), creates carry_forward rows for remainders
   * (Invariant 12 — original rows are never mutated in place), and writes
   * the immutable financial snapshot (Invariants 3-5) on staff_settlements.
   */
  async function finalize(
    settlementId: string,
    staffId: string,
    options: FinalizeOptions,
  ): Promise<StaffSettlement> {
    const device = useDeviceStore()
    const session = useSessionStore()

    // Lock exchange rate (already provided by caller for syp; usd needs none).
    const lockedRate = options.settlementCurrency === 'syp' ? options.settlementRate! : null

    // Re-read outstanding ledger fresh — never trust UI-held state at commit time.
    const outstandingRows = await db.getAll<StaffLedgerRowLocal>(
      `SELECT * FROM staff_ledger WHERE shop_id = ? AND staff_id = ? AND settlement_id IS NULL`,
      [device.shopId, staffId],
    )
    const byId = new Map(outstandingRows.map(r => [r.id, r]))

    // Re-validate every applied amount <= remaining (defense in depth;
    // the UI already checked this via applyLedgerEntry()).
    const plannedCarryForwards: Array<{ sourceId: string; amountUsd: number }> = []
    let appliedTotalUsd = 0
    for (const app of options.applications) {
      const row = byId.get(app.ledgerEntryId)
      if (!row) throw new Error(`ledger entry ${app.ledgerEntryId} not found or already consumed`)
      if (app.applyAmountUsd > row.amount_usd) {
        throw new Error(`apply amount ${app.applyAmountUsd} exceeds entry remaining amount ${row.amount_usd}`)
      }
      const direction = row.entry_type === 'bonus' ? 1 : -1
      appliedTotalUsd += direction * app.applyAmountUsd
      const remainder = Math.round((row.amount_usd - app.applyAmountUsd) * 100) / 100
      if (remainder > 0) plannedCarryForwards.push({ sourceId: row.id, amountUsd: remainder })
    }
    const finalAmountUsd = Math.round((options.baseSalaryUsd + appliedTotalUsd) * 100) / 100

    const staffRow = await db.getOptional<{ name: string; role: string }>(
      `SELECT name, role FROM staff WHERE id = ?`, [staffId],
    )
    const existingSettlementRow = await db.getOptional<StaffSettlementRow>(
      `SELECT * FROM staff_settlements WHERE id = ?`, [settlementId],
    )
    if (!existingSettlementRow) throw new Error(`settlement ${settlementId} not found`)
    if (existingSettlementRow.status !== 'draft') {
      throw new Error(`settlement ${settlementId} already finalized (status: ${existingSettlementRow.status})`)
    }

    let finalizedAt = ''

    await executeBusinessOperation(
      async () => {
        const now = new Date().toISOString()
        // All writes inside one transaction (Invariant 10) — link consumed
        // rows, insert carry-forwards, write the snapshot; all-or-nothing.
        await db.writeTransaction(async (tx) => {
          for (const app of options.applications) {
            await tx.execute(
              `UPDATE staff_ledger SET settlement_id = ? WHERE id = ?`,
              [settlementId, app.ledgerEntryId],
            )
          }
          for (const cf of plannedCarryForwards) {
            await tx.execute(
              `INSERT INTO staff_ledger
                 (id, shop_id, staff_id, entry_type, amount_usd, currency_entered, locked_rate,
                  note, source_type, source_id, created_by_staff_id, client_operation_id,
                  settlement_id, created_at, sync_status)
               VALUES (?, ?, ?, 'carry_forward', ?, 'usd', NULL, ?, 'settlement', ?, ?, ?, NULL, ?, 'pending')`,
              [
                uuidv4(), device.shopId, staffId, cf.amountUsd,
                `Carry-forward from ${cf.sourceId}`, cf.sourceId,
                session.activeStaff!.id, uuidv4(), now,
              ],
            )
          }
          await tx.execute(
            `UPDATE staff_settlements
             SET status = 'finalized', base_salary_usd = ?, settlement_currency = ?, locked_rate = ?,
                 applied_amount_usd = ?, final_amount_usd = ?, notes = ?,
                 staff_name_snapshot = ?, staff_role_snapshot = ?, finalized_at = ?
             WHERE id = ?`,
            [
              options.baseSalaryUsd, options.settlementCurrency, lockedRate,
              appliedTotalUsd, finalAmountUsd, options.notes,
              staffRow?.name ?? null, staffRow?.role ?? null, now, settlementId,
            ],
          )
        })
        finalizedAt = now
        return { finalAmountUsd, now }
      },
      {
        audit: ({ finalAmountUsd }) => logStaffSettlementFinalized(
          settlementId, staffId, existingSettlementRow.period_month, finalAmountUsd,
          options.settlementCurrency, finalAmountUsd < 0,
        ),
      },
      'can_view_expenses',
    )

    // Build the result from the pre-write row plus the values we just wrote —
    // avoids relying on a second round-trip re-read reflecting our own write.
    return rowToSettlement({
      ...existingSettlementRow,
      status: 'finalized',
      base_salary_usd: options.baseSalaryUsd,
      settlement_currency: options.settlementCurrency,
      locked_rate: lockedRate,
      applied_amount_usd: appliedTotalUsd,
      final_amount_usd: finalAmountUsd,
      notes: options.notes,
      staff_name_snapshot: staffRow?.name ?? null,
      staff_role_snapshot: staffRow?.role ?? null,
      finalized_at: finalizedAt,
    })
  }

  /**
   * Marks an already-finalized settlement as paid. Never recalculates
   * financial values (Invariant: a finalized settlement's snapshot is
   * immutable) — only sets status/paid_at/paid_by_staff_id/payment_method.
   */
  async function markPaid(
    settlementId: string,
    staffId: string,
    options: { paymentMethod: 'cash' | 'bank' | 'other' },
  ): Promise<StaffSettlement> {
    const session = useSessionStore()

    const existingSettlementRow = await db.getOptional<StaffSettlementRow>(
      `SELECT * FROM staff_settlements WHERE id = ?`, [settlementId],
    )
    if (!existingSettlementRow) throw new Error(`settlement ${settlementId} not found`)
    if (existingSettlementRow.status !== 'finalized') {
      throw new Error(`settlement ${settlementId} is not finalized (status: ${existingSettlementRow.status})`)
    }

    await paySettlementService(
      settlementId, staffId, session.activeStaff!.id, options.paymentMethod,
      { logStaffSettlementPaid },
    )
    const row = await db.getOptional<StaffSettlementRow>(
      `SELECT * FROM staff_settlements WHERE id = ?`, [settlementId],
    )
    return rowToSettlement(row!)
  }

  return { createDraft, applyLedgerEntry, finalize, markPaid }
}
