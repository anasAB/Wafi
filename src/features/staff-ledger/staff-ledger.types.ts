export type StaffLedgerEntryType =
  | 'advance' | 'bonus' | 'penalty' | 'carry_forward' | 'write_off' | 'correction'

export type StaffLedgerSourceType = 'manual' | 'shift' | 'settlement'

export type StaffSettlementStatus = 'draft' | 'finalized' | 'paid'

export type StaffSettlementPaymentMethod = 'cash' | 'bank' | 'other'

/** Plain-language Arabic/English label — the only place raw enum values may
 * leak into copy. UI components must call this, never render entryType raw. */
export function ledgerEntryTypeLabel(type: StaffLedgerEntryType): string {
  switch (type) {
    case 'advance':       return 'سلفة'
    case 'bonus':         return 'مكافأة'
    case 'penalty':       return 'خصم'
    case 'write_off':     return 'إسقاط دين'
    case 'correction':    return 'تصحيح دفعة سابقة'
    case 'carry_forward': return 'الرصيد المتبقي'
  }
}

export interface StaffLedgerEntry {
  id:                string
  shopId:            string
  staffId:           string
  entryType:         StaffLedgerEntryType
  amountUsd:         number
  currencyEntered:   'usd' | 'syp'
  lockedRate:        number | null
  note:              string | null
  sourceType:        StaffLedgerSourceType
  sourceId:          string | null
  createdByStaffId:  string
  clientOperationId: string
  settlementId:      string | null
  createdAt:         string
}

export interface NewStaffLedgerEntry {
  staffId:    string
  entryType:  Exclude<StaffLedgerEntryType, 'carry_forward'> // system-generated only
  amount:     number
  currency:   'usd' | 'syp'
  lockedRate?: number // required when currency = 'syp'
  note?:      string
  sourceType?: StaffLedgerSourceType
  sourceId?:  string
}

export interface StaffSettlement {
  id:                 string
  shopId:             string
  staffId:            string
  settlementNumber:   string
  periodMonth:        string // YYYY-MM-01
  status:             StaffSettlementStatus
  baseSalaryUsd:      number | null
  settlementCurrency: 'usd' | 'syp' | null
  lockedRate:         number | null
  appliedAmountUsd:   number | null
  finalAmountUsd:     number | null
  notes:              string | null
  staffNameSnapshot:  string | null
  staffRoleSnapshot:  string | null
  finalizedAt:        string | null
  paidAt:             string | null
  paidByStaffId:      string | null
  paymentMethod:      StaffSettlementPaymentMethod | null
  clientOperationId:  string
  createdAt:          string
}
