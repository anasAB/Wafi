export type TermFrequency = 'weekly' | 'monthly'
export type PlanStatus    = 'active' | 'completed' | 'defaulted' | 'cancelled'

// The DB only ever stores 'pending' | 'paid' | 'voided'. The spec's
// upcoming/due/overdue distinction is a DISPLAY bucket derived at read time
// from due_date vs "today" (see dueBucket() below), not a stored value — there
// is no background scheduler in this offline-first app to keep a stored bucket
// from going stale, matching how zombie-shift detection already works
// read-time-only in this codebase.
export type DueStatus = 'pending' | 'paid' | 'voided'
export type DueBucket = 'upcoming' | 'due' | 'overdue' | 'paid' | 'voided'

export interface InstallmentPlan {
  planId:         string
  shopId:         string
  customerId:     string
  saleId:         string
  totalAmountUsd: number
  downPaymentUsd: number
  termCount:      number
  termFrequency:  TermFrequency
  startDate:      string   // YYYY-MM-DD
  status:         PlanStatus
  createdAt:      string
  createdBy:      string
}

export interface InstallmentDue {
  dueId:         string
  planId:        string
  shopId:        string
  dueDate:       string   // YYYY-MM-DD
  amountDueUsd:  number
  amountPaidUsd: number
  status:        DueStatus
}

export interface NewInstallmentPlanInput {
  customerId:     string
  saleId:         string
  totalAmountUsd: number
  downPaymentUsd: number
  termCount:      number
  termFrequency:  TermFrequency
  startDate:      string   // YYYY-MM-DD
}

/**
 * Display bucket for one due, derived from its stored status + due_date vs
 * "today" (caller-supplied ISO date, e.g. `new Date().toISOString().slice(0,10)`
 * — kept as a parameter, not `new Date()` inside, so this stays pure/testable).
 */
export function dueBucket(due: Pick<InstallmentDue, 'status' | 'dueDate'>, today: string): DueBucket {
  if (due.status === 'paid')   return 'paid'
  if (due.status === 'voided') return 'voided'
  if (due.dueDate < today)     return 'overdue'
  if (due.dueDate === today)   return 'due'
  return 'upcoming'
}
