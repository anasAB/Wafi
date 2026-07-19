import { v4 as uuidv4 } from 'uuid'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import type { StaffSettlement, StaffLedgerEntry } from '@/features/staff-ledger/staff-ledger.types'

type StaffSettlementRow = {
  id: string; shop_id: string; staff_id: string; settlement_number: string
  period_month: string; status: string; base_salary_usd: number | null
  settlement_currency: 'usd' | 'syp' | null; locked_rate: number | null
  applied_amount_usd: number | null; final_amount_usd: number | null
  notes: string | null; staff_name_snapshot: string | null; staff_role_snapshot: string | null
  finalized_at: string | null; paid_at: string | null; paid_by_staff_id: string | null
  payment_method: string | null; client_operation_id: string; created_at: string
}

function rowToSettlement(r: StaffSettlementRow): StaffSettlement {
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

  return { createDraft, applyLedgerEntry }
}
