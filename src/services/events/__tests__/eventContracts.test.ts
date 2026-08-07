import { describe, it, expect } from 'vitest'
import type {
  DomainEvent, DomainEventType,
  SaleCompletedPayload, SaleDiscountedPayload, ReturnedPayload, DebtChangedPayload, InstallmentDuePaidPayload,
  CashMovementRecordedPayload, StockTakenPayload, StockReceivedPayload,
  ShiftOpenedPayload, ShiftClosedPayload, InventoryAdjustedPayload,
  ProductPriceChangedPayload, ProductCostUpdatedPayload, ProductCreatedPayload,
  StaffLedgerEntryAddedPayload, SettlementPaidPayload, ExpenseRecordedPayload,
  DeviceRegisteredPayload, PinLockedOutPayload,
} from '@/services/events/domainEvent.types'

// Every field fixed to a literal value -- occurredAt/staffId/shopId are NOT generated at
// test time, specifically so the snapshot is stable across runs (design spec §5).
const V = 1
const STAFF = 's1'
const SHOP = 'shop1'
const WHEN = '2026-08-05T00:00:00.000Z'

const FIXTURES: Record<DomainEventType, DomainEvent> = {
  'sale.completed': {
    type: 'sale.completed', entityId: 'sale1',
    payload: {
      saleId: 'sale1', shopId: SHOP, staffId: STAFF, totalUsd: 10, totalSyp: 150000,
      paymentSummary: { cashUsd: 10, cashSyp: 0, cardTotal: 0, creditTotal: 0, methodCount: 1 },
      itemCount: 2, discountApplied: false,
    } satisfies SaleCompletedPayload,
    payloadVersion: V, staffId: STAFF, shopId: SHOP, occurredAt: WHEN,
  },
  'sale.discounted': {
    type: 'sale.discounted', entityId: 'sale1',
    payload: {
      discountType: 'percent', discountValue: 10, discountPercentage: 10,
      finalPriceUsd: 9, belowCost: false, pinApproval: false,
    } satisfies SaleDiscountedPayload,
    payloadVersion: V, staffId: STAFF, shopId: SHOP, occurredAt: WHEN,
  },
  'sale.returned': {
    type: 'sale.returned', entityId: 'r1',
    payload: { returnId: 'r1', saleId: 'sale1', refundAmountUsd: 5, restockedItemCount: 1 } satisfies ReturnedPayload,
    payloadVersion: V, staffId: STAFF, shopId: SHOP, occurredAt: WHEN,
  },
  'customer.debt_changed': {
    type: 'customer.debt_changed', entityId: 'c1',
    payload: { customerId: 'c1', deltaUsd: -5, newBalanceUsd: 10, reason: 'return' } satisfies DebtChangedPayload,
    payloadVersion: V, staffId: STAFF, shopId: SHOP, occurredAt: WHEN,
  },
  'installment.due_paid': {
    type: 'installment.due_paid', entityId: 'c1',
    payload: { customerId: 'c1', amount: 20, remainingBalance: 80 } satisfies InstallmentDuePaidPayload,
    payloadVersion: V, staffId: STAFF, shopId: SHOP, occurredAt: WHEN,
  },
  'cash.movement_recorded': {
    type: 'cash.movement_recorded', entityId: 'm1',
    payload: { movementId: 'm1', shiftId: 'sh1', direction: 'in', category: 'float_topup', currency: 'USD', amountUsd: 20 } satisfies CashMovementRecordedPayload,
    payloadVersion: V, staffId: STAFF, shopId: SHOP, occurredAt: WHEN,
  },
  'stock.taken': {
    type: 'stock.taken', entityId: 'st1',
    payload: { sessionId: 'st1', productCount: 10, unexplainedVarianceCount: 0 } satisfies StockTakenPayload,
    payloadVersion: V, staffId: STAFF, shopId: SHOP, occurredAt: WHEN,
  },
  'stock.received': {
    type: 'stock.received', entityId: 'rc1',
    payload: { receivingId: 'rc1', supplierId: 'sup1', skuCount: 5, totalCost: 100 } satisfies StockReceivedPayload,
    payloadVersion: V, staffId: STAFF, shopId: SHOP, occurredAt: WHEN,
  },
  'shift.opened': {
    type: 'shift.opened', entityId: 'sh1',
    payload: { shiftId: 'sh1', staffId: STAFF, openingCash: 50 } satisfies ShiftOpenedPayload,
    payloadVersion: V, staffId: STAFF, shopId: SHOP, occurredAt: WHEN,
  },
  'shift.closed': {
    type: 'shift.closed', entityId: 'sh1',
    payload: { shiftId: 'sh1', staffId: STAFF, expectedCash: 100, countedCash: 98, variance: -2 } satisfies ShiftClosedPayload,
    payloadVersion: V, staffId: STAFF, shopId: SHOP, occurredAt: WHEN,
  },
  'inventory.adjusted': {
    type: 'inventory.adjusted', entityId: 'p1',
    payload: { productId: 'p1', deltaQty: -3, reason: 'damaged' } satisfies InventoryAdjustedPayload,
    payloadVersion: V, staffId: STAFF, shopId: SHOP, occurredAt: WHEN,
  },
  'product.price_changed': {
    type: 'product.price_changed', entityId: 'p1',
    payload: { productId: 'p1', oldPriceUsd: 10, newPriceUsd: 12 } satisfies ProductPriceChangedPayload,
    payloadVersion: V, staffId: STAFF, shopId: SHOP, occurredAt: WHEN,
  },
  'product.cost_updated': {
    type: 'product.cost_updated', entityId: 'p1',
    payload: { productId: 'p1', oldCostUsd: 5, newCostUsd: 6 } satisfies ProductCostUpdatedPayload,
    payloadVersion: V, staffId: STAFF, shopId: SHOP, occurredAt: WHEN,
  },
  'product.created': {
    type: 'product.created', entityId: 'p1',
    payload: { productId: 'p1', name: 'Widget', categoryId: null } satisfies ProductCreatedPayload,
    payloadVersion: V, staffId: STAFF, shopId: SHOP, occurredAt: WHEN,
  },
  'staff.ledger_entry_added': {
    type: 'staff.ledger_entry_added', entityId: STAFF,
    payload: { staffId: STAFF, entryType: 'advance', amount: 15 } satisfies StaffLedgerEntryAddedPayload,
    payloadVersion: V, staffId: STAFF, shopId: SHOP, occurredAt: WHEN,
  },
  'settlement.paid': {
    type: 'settlement.paid', entityId: STAFF,
    payload: { staffId: STAFF, amount: 15, ledgerBalanceAfter: 0 } satisfies SettlementPaidPayload,
    payloadVersion: V, staffId: STAFF, shopId: SHOP, occurredAt: WHEN,
  },
  'expense.recorded': {
    type: 'expense.recorded', entityId: 'e1',
    payload: { expenseId: 'e1', category: 'صيانة', amountUsd: 50, staffId: STAFF, photoUrl: undefined } satisfies ExpenseRecordedPayload,
    payloadVersion: V, staffId: STAFF, shopId: SHOP, occurredAt: WHEN,
  },
  'device.registered': {
    type: 'device.registered', entityId: 'd1',
    payload: { deviceId: 'd1', deviceCode: 'ABC123', isTemporary: false } satisfies DeviceRegisteredPayload,
    payloadVersion: V, staffId: STAFF, shopId: SHOP, occurredAt: WHEN,
  },
  'staff.pin_locked_out': {
    type: 'staff.pin_locked_out', entityId: 'lockout-occurrence-1',
    payload: { staffId: STAFF, lockoutMinutes: 5 } satisfies PinLockedOutPayload,
    payloadVersion: V, staffId: STAFF, shopId: SHOP, occurredAt: WHEN,
  },
}

describe.each(Object.entries(FIXTURES))('event contract: %s', (_type, fixture) => {
  it('matches its committed shape snapshot', () => {
    expect(fixture).toMatchSnapshot()
  })
})
