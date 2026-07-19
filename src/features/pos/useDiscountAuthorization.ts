import type { StaffRole } from '@/features/staff/staff.types'
import { isBelowCost } from '@/features/pos/discounts'

export interface DiscountCaps {
  cashierPct: number
  managerPct: number
}

export function requiresPinApproval(params: {
  role:          StaffRole
  discountPct:   number
  finalPriceUsd: number
  unitCostUsd:   number
  caps:          DiscountCaps
}): boolean {
  const { role, discountPct, finalPriceUsd, unitCostUsd, caps } = params

  if (isBelowCost(finalPriceUsd, unitCostUsd)) return true
  if (role === 'owner') return false

  const cap = role === 'manager' ? caps.managerPct : caps.cashierPct
  return discountPct > cap
}
