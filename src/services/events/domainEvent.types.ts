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
  staffId: string
  shopId: string
  occurredAt: string
}
