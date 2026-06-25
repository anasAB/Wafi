export type CashMovementDirection = 'in' | 'out'
export type CashCurrency = 'USD' | 'SYP'

export type CashMovementCategory =
  | 'paid_supplier'
  | 'drop_to_safe'
  | 'owner_withdrawal'
  | 'other_out'
  | 'float_topup'
  | 'other_in'

export interface CashMovementCategoryDef {
  key:       CashMovementCategory
  direction: CashMovementDirection
  labelAr:   string
}

// Each category is fixed to exactly one direction (the UI shows only the
// categories valid for the chosen direction). 'other_*' is split per direction
// so the key→direction map stays 1:1 and unambiguous.
export const CASH_MOVEMENT_CATEGORIES: CashMovementCategoryDef[] = [
  { key: 'paid_supplier',    direction: 'out', labelAr: 'دفع لمورد' },
  { key: 'drop_to_safe',     direction: 'out', labelAr: 'إيداع للخزنة' },
  { key: 'owner_withdrawal', direction: 'out', labelAr: 'سحب المالك' },
  { key: 'other_out',        direction: 'out', labelAr: 'أخرى (صرف)' },
  { key: 'float_topup',      direction: 'in',  labelAr: 'تغذية الصندوق' },
  { key: 'other_in',         direction: 'in',  labelAr: 'أخرى (إيداع)' },
]

export function categoriesForDirection(d: CashMovementDirection): CashMovementCategoryDef[] {
  return CASH_MOVEMENT_CATEGORIES.filter(c => c.direction === d)
}

export interface CashMovement {
  id:              string
  shopId:          string
  deviceId:        string
  shiftId:         string
  staffId:         string | null
  direction:       CashMovementDirection
  category:        CashMovementCategory
  currency:        CashCurrency
  amount:          number          // raw in `currency`; integer when SYP
  note:            string | null
  voidsMovementId: string | null   // set on a reversing (void) row → the movement it reverses
  createdAt:       string
}
