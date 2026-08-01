export interface DiscountCapsErrors {
  cashier?: string
  manager?: string
  cross?: string
}

export interface ParsedDiscountCaps {
  cashierPct: number
  managerPct: number
}

export interface DiscountCapsValidationResult {
  valid: boolean
  errors: DiscountCapsErrors
  parsed?: ParsedDiscountCaps
}

const REQUIRED = 'الرجاء إدخال قيمة'
const OUT_OF_RANGE = 'يجب أن تكون النسبة بين 0 و100'
const TOO_PRECISE = 'يُسمح بمنزلتين عشريتين كحد أقصى'
const CASHIER_EXCEEDS_MANAGER = 'لا يمكن أن يتجاوز حد الكاشير حد المدير'

/** Same range Postgres enforces via CHECK in 052_sale_discounts.sql. */
export function isValidCapPct(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 100
}

function validateField(raw: string): { value?: number; error?: string } {
  const trimmed = raw.trim()
  if (trimmed === '') return { error: REQUIRED }

  const value = Number(trimmed)
  if (Number.isNaN(value) || !isValidCapPct(value)) return { error: OUT_OF_RANGE }

  const rounded = Math.round(value * 100) / 100
  if (Math.abs(rounded - value) > 1e-6) return { error: TOO_PRECISE }

  return { value: rounded }
}

export function validateDiscountCaps(input: { cashier: string; manager: string }): DiscountCapsValidationResult {
  const errors: DiscountCapsErrors = {}
  const cashier = validateField(input.cashier)
  const manager = validateField(input.manager)

  if (cashier.error) errors.cashier = cashier.error
  if (manager.error) errors.manager = manager.error

  if (!cashier.error && !manager.error && cashier.value! > manager.value!) {
    errors.cross = CASHIER_EXCEEDS_MANAGER
  }

  const valid = Object.keys(errors).length === 0
  if (!valid) return { valid, errors }

  return { valid, errors, parsed: { cashierPct: cashier.value!, managerPct: manager.value! } }
}
