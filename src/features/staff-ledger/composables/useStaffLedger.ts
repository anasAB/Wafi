import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { useSessionStore } from '@/store/session.store'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'
import { addLedgerEntry as addLedgerEntryService } from '@/services/staff.service'
import type { StaffLedgerEntry, NewStaffLedgerEntry } from '@/features/staff-ledger/staff-ledger.types'

type StaffLedgerRow = {
  id: string; shop_id: string; staff_id: string; entry_type: string
  amount_usd: number; currency_entered: 'usd' | 'syp'; locked_rate: number | null
  note: string | null; source_type: string; source_id: string | null
  created_by_staff_id: string; client_operation_id: string
  settlement_id: string | null; created_at: string
}

function rowToEntry(r: StaffLedgerRow): StaffLedgerEntry {
  return {
    id: r.id, shopId: r.shop_id, staffId: r.staff_id,
    entryType: r.entry_type as StaffLedgerEntry['entryType'],
    amountUsd: r.amount_usd, currencyEntered: r.currency_entered,
    lockedRate: r.locked_rate, note: r.note,
    sourceType: r.source_type as StaffLedgerEntry['sourceType'],
    sourceId: r.source_id, createdByStaffId: r.created_by_staff_id,
    clientOperationId: r.client_operation_id, settlementId: r.settlement_id,
    createdAt: r.created_at,
  }
}

export function useStaffLedger() {
  const entries = ref<StaffLedgerEntry[]>([])
  const { logStaffLedgerEntryCreated } = useAuditLog()

  async function addLedgerEntry(input: NewStaffLedgerEntry): Promise<StaffLedgerEntry> {
    const device = useDeviceStore()
    const session = useSessionStore()
    return addLedgerEntryService(
      device.shopId, session.activeStaff!.id, input, { logStaffLedgerEntryCreated },
    )
  }

  async function getOutstandingEntries(staffId: string): Promise<{ usd: StaffLedgerEntry[]; syp: StaffLedgerEntry[] }> {
    const device = useDeviceStore()
    const rows = await db.getAll<StaffLedgerRow>(
      `SELECT * FROM staff_ledger
       WHERE shop_id = ? AND staff_id = ? AND settlement_id IS NULL
       ORDER BY created_at ASC`,
      [device.shopId, staffId],
    )
    const parsed = rows.map(rowToEntry)
    entries.value = parsed
    return {
      usd: parsed.filter(e => e.currencyEntered === 'usd'),
      syp: parsed.filter(e => e.currencyEntered === 'syp'),
    }
  }

  return { entries, addLedgerEntry, getOutstandingEntries }
}
