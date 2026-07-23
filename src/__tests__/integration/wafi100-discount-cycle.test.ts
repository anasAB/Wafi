// Drives the real composables together end-to-end against the shared mock db
// (src/__tests__/__mocks__/db.ts), proving the discount fields survive the
// full sale -> return -> Z-report path. Mirrors the mocking conventions
// already used by usePayment.test.ts and useZReport.test.ts rather than
// inventing a new mocking style — this repo has no real in-memory SQLite
// test double.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { db } from '@/data/powersync/db'
import { useSaleStore } from '@/store/sale.store'
import { useSessionStore } from '@/store/session.store'
import { useShiftStore } from '@/features/shifts/shift.store'
import { useDeviceStore } from '@/store/device.store'
import { usePayment } from '@/features/payment/usePayment'
import { useReturnSheet } from '@/features/returns/composables/useReturnSheet'
import { useZReport } from '@/features/shifts/composables/useZReport'
import type { CashierShift } from '@/features/shifts/shift.types'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('WAFI-100 discount cycle', () => {
  it('sale discount -> completed sale -> return -> Z-report totals reconcile', async () => {
    const saleStore    = useSaleStore()
    const sessionStore = useSessionStore()
    const shiftStore    = useShiftStore()
    const deviceStore   = useDeviceStore()

    sessionStore.setActiveStaff({
      id: 'staff-1', shopId: 'shop-1', name: 'Cashier', pinHash: '', pinSalt: null,
      role: 'cashier', isActive: true, createdAt: '',
      permissions: { can_view_reports: false, can_manage_products: false, can_manage_customers: false, can_view_expenses: false, can_manage_settings: false },
    })
    shiftStore.openShift('shift-1', {
      id: 'staff-1', shopId: 'shop-1', name: 'Cashier', pinHash: '', pinSalt: null,
      role: 'cashier', isActive: true, createdAt: '',
      permissions: { can_view_reports: false, can_manage_products: false, can_manage_customers: false, can_view_expenses: false, can_manage_settings: false },
    } as any)

    saleStore.addLine({
      productId: 'p1', nameAr: 'قلم', quantity: 1,
      unitPriceUsd: 10, unitCostUsd: 4, lineTotalUsd: 10,
      availableStock: 10, listPriceUsd: 10,
    })
    saleStore.setLockedRate(1)
    saleStore.applyLineDiscount('p1', { type: 'percent', value: 10 }) // net line = 9

    // --- Sale ---
    vi.mocked(db.writeTransaction).mockImplementationOnce(async (fn: any) => {
      const tx = {
        execute: vi.fn().mockResolvedValue({ rows: { _array: [{ cost_price_usd: 4, current_stock: 10 }] } }),
      }
      await fn(tx as any)
    })

    const payment = usePayment()
    payment.selectMethod('cash_usd')
    payment.amountReceived.value = 9
    const completed = await payment.confirm()

    expect(completed.lines[0].discountType).toBe('percent')
    expect(completed.lines[0].unitPriceUsd).toBeCloseTo(9, 2)

    // --- Return ---
    vi.mocked(db.execute).mockImplementationOnce(async () => ({
      rows: { _array: [{ id: completed.saleId, display_sale_number: completed.displaySaleNumber, customer_id: null, customer_name: null }] },
    }) as any)
    vi.mocked(db.execute).mockImplementationOnce(async () => ({ rows: { _array: [{ rate: 1 }] } }) as any)
    vi.mocked(db.getAll).mockImplementationOnce(async () => ([
      { product_id: 'p1', product_name: 'قلم', quantity: 1, unit_price_usd: 9 },
    ]) as any)
    vi.mocked(db.getAll).mockImplementationOnce(async () => ([]) as any) // no prior returns

    const returnSheet = useReturnSheet(completed.saleId)
    await returnSheet.load()
    expect(returnSheet.lines.value[0].unitPriceUsd).toBe(9) // net, not list price 10
    returnSheet.lines.value[0].selected = true
    expect(returnSheet.refundTotalUsd.value).toBeCloseTo(9, 2)

    // --- Z-report ---
    // getOptional default (per the shared mock) resolves { total: 0, count: 0 },
    // so only the discount-totals query needs a specific value; matched by SQL
    // text (the same convention useZReport.test.ts uses), not call position.
    vi.mocked(db.getOptional).mockImplementation(async (sql: unknown) => {
      const s = sql as string
      if (/discount_amount_usd/.test(s)) return { total: 1 } as any
      return { total: 0, count: 0 } as any
    })
    vi.mocked(db.getAll).mockImplementation(async (sql: unknown) => {
      const s = sql as string
      if (/FROM sales\b/.test(s) && /GROUP BY/.test(s)) {
        return [{ staffId: 'staff-1', name: 'Cashier', salesCount: 1, totalUsd: 9, discountsUsd: 1 }] as any
      }
      return [] as any
    })

    const shift: CashierShift = {
      id: 'shift-1', shopId: 'shop-1', deviceId: deviceStore.deviceId,
      staffId: 'staff-1', openedAt: new Date(Date.now() - 3_600_000).toISOString(),
      closedAt: null, openingCashUsd: 0, openingCashSyp: 0,
      closingCashUsd: null, closingCashSyp: null, status: 'open',
    }

    const zReport = useZReport()
    const metrics = await zReport.compute(shift, 9, 0)

    expect(metrics.totalDiscountsUsd).toBeCloseTo(1, 2) // 10% of $10 = $1
    expect(metrics.byOperator[0]).toMatchObject({ staffId: 'staff-1', discountsUsd: 1 })
  })
})
