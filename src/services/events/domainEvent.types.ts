// Split by domain (rather than one flat DomainEventType) so the registry stays
// readable as it grows past this ticket's ~9 members — WAFI-140/143 are
// expected to add many more events, and a single enum with 70+ members mixing
// every domain is harder to navigate than five short, domain-scoped ones.
//
// const-object + literal-union instead of `enum`: this repo's build (`vue-tsc -b`)
// has `erasableSyntaxOnly` enabled, which rejects real TS `enum` declarations
// (they compile to runtime code, not just erasable type info). This pattern reads
// and is accessed identically at every call site (`ExpenseEventType.Recorded`),
// so nothing downstream needed to change.

export const ExpenseEventType = {
  Recorded: 'expense.recorded',
} as const
export type ExpenseEventType = typeof ExpenseEventType[keyof typeof ExpenseEventType]

export const InventoryEventType = {
  StockReceived: 'stock.received',
  Adjusted: 'inventory.adjusted',
} as const
export type InventoryEventType = typeof InventoryEventType[keyof typeof InventoryEventType]

export const CustomerEventType = {
  DebtChanged: 'customer.debt_changed',
  InstallmentDuePaid: 'installment.due_paid',
} as const
export type CustomerEventType = typeof CustomerEventType[keyof typeof CustomerEventType]

export const SalesEventType = {
  Completed: 'sale.completed',
  Discounted: 'sale.discounted',
} as const
export type SalesEventType = typeof SalesEventType[keyof typeof SalesEventType]

export const StaffEventType = {
  ShiftOpened: 'shift.opened',
  ShiftClosed: 'shift.closed',
  SettlementPaid: 'settlement.paid',
  LedgerEntryAdded: 'staff.ledger_entry_added',
  PinLockedOut: 'staff.pin_locked_out',
} as const
export type StaffEventType = typeof StaffEventType[keyof typeof StaffEventType]

export const ReturnsEventType = {
  Returned: 'sale.returned',
} as const
export type ReturnsEventType = typeof ReturnsEventType[keyof typeof ReturnsEventType]

export const CashEventType = {
  MovementRecorded: 'cash.movement_recorded',
} as const
export type CashEventType = typeof CashEventType[keyof typeof CashEventType]

export const StockTakeEventType = {
  Taken: 'stock.taken',
} as const
export type StockTakeEventType = typeof StockTakeEventType[keyof typeof StockTakeEventType]

export const ProductEventType = {
  PriceChanged: 'product.price_changed',
  CostUpdated:  'product.cost_updated',
  Created:      'product.created',
} as const
export type ProductEventType = typeof ProductEventType[keyof typeof ProductEventType]

export const DeviceEventType = {
  Registered: 'device.registered',
} as const
export type DeviceEventType = typeof DeviceEventType[keyof typeof DeviceEventType]

export type DomainEventType =
  | ExpenseEventType | InventoryEventType | CustomerEventType | SalesEventType | StaffEventType
  | ReturnsEventType | CashEventType | StockTakeEventType | ProductEventType | DeviceEventType

/** WAFI-156: the finite set of event types the data-driven rule engine has a
 *  registered subscriber for. business_rules.event_type must always be a
 *  member of this set (enforced by the seed migration being the only writer
 *  of event_type, and by the event-contract test in businessRuleSubscriber.test.ts)
 *  -- adding a new value here is a deliberate vocabulary decision, not a
 *  runtime-data-only change (see the design spec §1). */
export type DataDrivenRuleEventType = 'sale.returned' | 'shift.closed'

export interface DomainEvent<TPayload = unknown> {
  type: DomainEventType
  /** ID of the primary entity this event is about (expenseId, receivingId, saleId, ...) — the
   *  one field every subscriber can rely on regardless of domain, so logging/indexing/routing
   *  doesn't require knowing each event's payload shape. */
  entityId: string
  payload: TPayload
  /** Starts at 1 for every event this sprint (WAFI-140 Sprint 1). Never change an existing
   *  version's payload shape — a breaking payload change ships as version 2, with both
   *  versions supported by subscribers until deprecated (design spec §4). */
  payloadVersion: number
  staffId: string
  shopId: string
  occurredAt: string
}

// Per-event payload interfaces (WAFI-140 Sprint 1, design spec §4: "typed payloads, not
// anonymous objects"). Each mirrors the object literal already produced by its service's
// `toEvent` hook prior to this ticket -- no payload SHAPE changes, only naming them.

export interface ExpenseRecordedPayload {
  expenseId: string
  category: string
  amountUsd: number
  staffId: string
  photoUrl: string | undefined
}

export interface StockReceivedPayload {
  receivingId: string
  supplierId: string
  skuCount: number
  totalCost: number
}

export interface InventoryAdjustedPayload {
  productId: string
  deltaQty: number
  reason: import('@/features/products/product.types').AdjustmentReason
}

export interface InstallmentDuePaidPayload {
  customerId: string
  amount: number
  remainingBalance: number
}

export interface SaleCompletedPayload {
  saleId: string
  shopId: string
  staffId: string
  totalUsd: number
  totalSyp: number
  paymentSummary: {
    cashUsd: number
    cashSyp: number
    cardTotal: number
    creditTotal: number
    methodCount: number
  }
  itemCount: number
  discountApplied: boolean
  /** WAFI-153: sum of quantity * unitCostUsd across every line, fractional dollars. */
  cogsUsd: number
  /** WAFI-153: sum of every line-level discount_amount_usd plus any sale-level discount, fractional dollars. */
  discountUsd: number
  /** WAFI-153: true iff at least one line had no/zero unit cost at completion time. */
  hasCostlessLine: boolean
}

export interface SaleDiscountedPayload {
  discountType: import('@/features/pos/discounts').DiscountType
  discountValue: number
  /** Included only when the discount service already computes it naturally
   *  (percentage-type discounts); never derived/backfilled for fixed-amount discounts
   *  where it isn't a natural value -- so every consumer reads the same number instead
   *  of each re-deriving discountValue / originalPrice inconsistently. */
  discountPercentage?: number
  finalPriceUsd: number
  belowCost: boolean
  pinApproval: boolean
}

export interface StaffLedgerEntryAddedPayload {
  staffId: string
  entryType: import('@/features/staff-ledger/staff-ledger.types').StaffLedgerEntryType
  amount: number
}

export interface SettlementPaidPayload {
  staffId: string
  amount: number
  ledgerBalanceAfter: number
}

export interface ShiftOpenedPayload {
  shiftId: string
  staffId: string
  openingCash: number
}

export interface ShiftClosedPayload {
  shiftId: string
  staffId: string
  expectedCash: number
  countedCash: number
  variance: number
}

// WAFI-140 Sprint 2 payloads (design spec §6).

export interface ReturnedPayload {
  returnId: string
  saleId: string
  refundAmountUsd: number
  restockedItemCount: number
  /** WAFI-153: restock-aware, per-(sale,product)-averaged COGS reversal, fractional dollars. */
  cogsReversalUsd: number
  /** WAFI-153: true iff this return's cumulative returned qty reaches the sale's total sold qty. */
  isFullReturn: boolean
  /** WAFI-153: copy of the original sale's hasCostlessLine flag. */
  saleWasCostless: boolean
  /** WAFI-153: the original sale's event_projection_day (YYYY-MM-DD), for the cross-day costless decrement. */
  originalSaleProjectionDay: string
}

export interface DebtChangedPayload {
  customerId: string
  /** Negative for a debt decrease (the only case this sprint wires -- a return). */
  deltaUsd: number
  newBalanceUsd: number
  /** 'return': existing WAFI-140 producer (useReturnSheet.ts), always a decrease.
   *  'credit_sale' (WAFI-145): new producer (sales.service.ts), always an increase
   *  -- the Customer Debt notification rule checks this discriminant explicitly
   *  rather than inferring intent from deltaUsd's sign alone. */
  reason: 'return' | 'credit_sale'
}

export interface CashMovementRecordedPayload {
  movementId: string
  shiftId: string
  direction: import('@/features/shifts/cashMovement.types').CashMovementDirection
  category: import('@/features/shifts/cashMovement.types').CashMovementCategory
  currency: import('@/features/shifts/cashMovement.types').CashCurrency
  amountUsd: number
}

export interface StockTakenPayload {
  sessionId: string
  productCount: number
  unexplainedVarianceCount: number
}

export interface ProductPriceChangedPayload {
  productId: string
  oldPriceUsd: number
  newPriceUsd: number
}

export interface ProductCostUpdatedPayload {
  productId: string
  oldCostUsd: number
  newCostUsd: number
}

export interface ProductCreatedPayload {
  productId: string
  name: string
  categoryId: string | null
}

export interface DeviceRegisteredPayload {
  deviceId: string
  deviceCode: string
  isTemporary: boolean
}

export interface PinLockedOutPayload {
  /** The staff member who tripped the lockout. NOT the entityId -- see the
   *  comment on entityId generation at the publish call site (usePinLockout.ts):
   *  the same staff member can independently lock out on two different devices
   *  (lockout state is per-device, WAFI-012), so two genuinely distinct lockout
   *  occurrences must not collide on entity identity. */
  staffId: string
  lockoutMinutes: number
}

// WAFI-140 Sprint 3 (design spec §3). Single source of truth for event-type sensitivity
// classification. Every DomainEventType MUST have an entry -- the Record type below is
// exhaustive by construction, so adding a new event type without adding a row here is a
// TypeScript compile error, not a silent gap.
//
// This registry does NOT generate the SQL policy in 077_events_per_type_rls.sql and any
// later migrations that amend it (currently: 081_events_pin_locked_out_rls.sql, which added
// the staff.pin_locked_out branch) -- no build step wires TS into migrations in this
// codebase. It is the documented, type-checked intent, cross-verified against the live
// policy by a pgTAP test (see supabase/tests/wafi140_events_rls.test.sql) that reads
// pg_get_expr() against a real database after migrations have run and asserts every
// non-'public' entry here has a matching WHEN branch, and vice versa. Two independent
// lists, one automated equality check between them -- neither can silently drift from the
// other without a failing test.
//
// Process rule: adding a new DomainEventType requires adding a row here (compiler-enforced)
// and, if that row is not 'public', adding the matching WHEN branch via a new migration that
// amends events_select_scoped (enforced by the pgTAP cross-check test above, not the
// compiler -- SQL text isn't something TypeScript can check).
export type EventSensitivity = 'public' | keyof import('@/features/staff/staff.types').StaffPermissions

// Enforcement mechanism: __tests__/eventSensitivity.test.ts snapshots this entire object, so
// ANY edit below shows up as a snapshot diff a reviewer must accept -- and when you accept one,
// check whether 077_events_per_type_rls.sql's CASE needs the matching change (manual, by
// design: generating SQL from TS is out of scope).
export const EVENT_SENSITIVITY: Record<DomainEventType, EventSensitivity> = {
  'sale.completed':           'public',
  'sale.discounted':          'public',
  'sale.returned':            'public',
  'customer.debt_changed':    'public',
  'installment.due_paid':     'public',
  'cash.movement_recorded':   'public',
  'stock.taken':               'public',
  'stock.received':           'public',
  'shift.opened':              'public',
  'shift.closed':              'public',
  'inventory.adjusted':       'public',
  'device.registered':        'public',
  'product.price_changed':    'public',
  'product.created':          'public',
  'staff.ledger_entry_added': 'can_view_staff_ledger',
  'settlement.paid':          'can_view_staff_ledger',
  'staff.pin_locked_out':     'can_view_staff_ledger',
  'expense.recorded':         'can_view_expenses',
  'product.cost_updated':     'can_view_reports',
}
