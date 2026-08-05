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
} as const
export type SalesEventType = typeof SalesEventType[keyof typeof SalesEventType]

export const StaffEventType = {
  ShiftOpened: 'shift.opened',
  ShiftClosed: 'shift.closed',
  SettlementPaid: 'settlement.paid',
  LedgerEntryAdded: 'staff.ledger_entry_added',
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
}

export interface DebtChangedPayload {
  customerId: string
  /** Negative for a debt decrease (the only case this sprint wires -- a return). */
  deltaUsd: number
  newBalanceUsd: number
  reason: 'return'
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

// WAFI-140 Sprint 3 (design spec §3). Single source of truth for event-type sensitivity
// classification. Every DomainEventType MUST have an entry -- the Record type below is
// exhaustive by construction, so adding a new event type without adding a row here is a
// TypeScript compile error, not a silent gap.
//
// This registry does NOT generate the SQL policy in 077_events_per_type_rls.sql (no build
// step wires TS into migrations in this codebase) -- it is the documented, type-checked
// intent, cross-verified against the live policy by a pgTAP test (see
// supabase/tests/wafi140_events_rls.test.sql) that reads pg_get_expr() against a real
// database after migrations have run and asserts every non-'public' entry here has a
// matching WHEN branch, and vice versa. Two independent lists, one automated equality check
// between them -- neither can silently drift from the other without a failing test.
//
// Process rule: adding a new DomainEventType requires adding a row here (compiler-enforced)
// and, if that row is not 'public', adding the matching WHEN branch to
// 077_events_per_type_rls.sql's events_select_scoped policy (enforced by the pgTAP
// cross-check test above, not the compiler -- SQL text isn't something TypeScript can check).
export type EventSensitivity = 'public' | keyof import('@/features/staff/staff.types').StaffPermissions

export const EVENT_SENSITIVITY: Record<DomainEventType, EventSensitivity> = {
  'sale.completed':           'public',
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
  'expense.recorded':         'can_view_expenses',
  'product.cost_updated':     'can_view_reports',
}
