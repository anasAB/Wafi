import { v4 as uuidv4 } from 'uuid'
import { ref } from 'vue'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { useSessionStore } from '@/store/session.store'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'
import { executeFinancialWrite } from '@/composables/executeFinancialWrite'
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
    if (input.amount <= 0) throw new Error('amount must be positive')
    if (input.currency === 'syp' && !(input.lockedRate! > 0)) {
      throw new Error('lockedRate is required and must be a positive rate when currency is syp')
    }
    const amountUsd = input.currency === 'syp'
      ? Math.round((input.amount / input.lockedRate!) * 100) / 100
      : input.amount

    if (amountUsd <= 0) {
      throw new Error('amount_usd must be positive after currency conversion')
    }

    return executeFinancialWrite(
      async () => {
        const device = useDeviceStore()
        const session = useSessionStore()
        const id = uuidv4()
        const clientOperationId = uuidv4()
        const now = new Date().toISOString()
        await db.execute(
          `INSERT INTO staff_ledger
             (id, shop_id, staff_id, entry_type, amount_usd, currency_entered, locked_rate,
              note, source_type, source_id, created_by_staff_id, client_operation_id,
              settlement_id, created_at, sync_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'pending')`,
          [
            id, device.shopId, input.staffId, input.entryType, amountUsd,
            input.currency, input.currency === 'syp' ? input.lockedRate : null,
            input.note ?? null, input.sourceType ?? 'manual', input.sourceId ?? null,
            session.activeStaff!.id, clientOperationId, now,
          ],
        )
        return rowToEntry({
          id, shop_id: device.shopId, staff_id: input.staffId, entry_type: input.entryType,
          amount_usd: amountUsd, currency_entered: input.currency,
          locked_rate: input.currency === 'syp' ? input.lockedRate! : null,
          note: input.note ?? null, source_type: input.sourceType ?? 'manual',
          source_id: input.sourceId ?? null, created_by_staff_id: session.activeStaff!.id,
          client_operation_id: clientOperationId, settlement_id: null, created_at: now,
        })
      },
      (entry) => logStaffLedgerEntryCreated(entry.id, entry.staffId, entry.entryType, entry.amountUsd),
      'can_view_expenses',
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
