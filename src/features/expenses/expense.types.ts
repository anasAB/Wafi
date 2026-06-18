export type ExpenseCategory =
  | 'إيجار'
  | 'كهرباء'
  | 'رواتب'
  | 'بضاعة'
  | 'صيانة'
  | 'أخرى'
  | string  // custom categories

export interface Expense {
  id:          string
  shopId:      string
  amount:      number
  currency:    'USD' | 'SYP'
  amountUsd:   number
  category:    string
  expenseDate: string   // YYYY-MM-DD
  notes?:      string
  photoUrl?:   string
  paidInCash:  boolean
  isRecurringMonthly?: boolean
  recurringStartDate?: string
  recurringEndDate?: string
  createdAt:   string
  syncStatus:  string
}

export interface NewExpense {
  amount:      number
  currency:    'USD' | 'SYP'
  amountUsd:   number
  category:    string
  expenseDate: string
  notes?:      string
  photoUrl?:   string
  paidInCash:  boolean
  isRecurringMonthly?: boolean
  recurringStartDate?: string
  recurringEndDate?: string
}

export const PREDEFINED_CATEGORIES: ExpenseCategory[] = [
  'إيجار', 'كهرباء', 'رواتب', 'بضاعة', 'صيانة', 'أخرى',
]
