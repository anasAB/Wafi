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

export type DomainEventType =
  | ExpenseEventType | InventoryEventType | CustomerEventType | SalesEventType | StaffEventType

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
