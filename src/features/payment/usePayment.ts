import { ref, computed } from 'vue'
import { useSaleStore } from '@/store/sale.store'
import { useSaleNumber } from '@/composables/useSaleNumber'
import { useSaleDraft } from '@/composables/useSaleDraft'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { useShiftStore } from '@/features/shifts/shift.store'
import { v4 as uuidv4 } from 'uuid'
import type { PaymentMethod, PaymentState, CompletedSale, SplitPaymentEntry } from './payment.types'

export function usePayment() {
  const saleStore      = useSaleStore()
  const deviceStore    = useDeviceStore()
  const shiftStore     = useShiftStore()
  const { nextNumber } = useSaleNumber()
  const { clearDraft } = useSaleDraft()

  const state          = ref<PaymentState>('method-selection')
  const isOpen         = ref(true)
  const method         = ref<PaymentMethod | null>(null)
  const amountReceived = ref<number | null>(null)
  const error          = ref<string | null>(null)

  // Split payment state
  const pendingPayments = ref<SplitPaymentEntry[]>([])

  const totalUsd = computed(() => saleStore.totalUsd)

  const totalSyp = computed(() => {
    const rate = saleStore.lockedExchangeRate
    if (rate === null) return 0
    return Math.round(totalUsd.value * rate)
  })

  const round2 = (n: number) => Math.round(n * 100) / 100

  // Split computeds
  const paidUsd = computed(() =>
    pendingPayments.value.reduce((s, p) => s + p.amountUsd, 0)
  )

  const remainingUsd = computed(() =>
    Math.max(0, totalUsd.value - paidUsd.value)
  )

  // Live change for the single-payment (non-split) flow, in the method's native currency.
  const changeDue = computed(() => {
    if (method.value === 'cash_usd' && amountReceived.value !== null) {
      return Math.max(0, round2(amountReceived.value - totalUsd.value))
    }
    if (method.value === 'cash_syp' && amountReceived.value !== null) {
      return Math.max(0, Math.round(amountReceived.value - totalSyp.value))
    }
    return null
  })

  // Amount typed on the keypad, converted to USD (cash_syp is entered in SYP).
  const enteredUsd = computed(() => {
    if (amountReceived.value === null) return null
    const rate = saleStore.lockedExchangeRate ?? 1
    return method.value === 'cash_syp' ? amountReceived.value / rate : amountReceived.value
  })

  // A single payment that settles the whole sale in one tender (cash may overpay → change).
  const canConfirmSingle = computed(() => {
    if (pendingPayments.value.length > 0) return false
    if (method.value === 'card' || method.value === 'credit') return true
    if (enteredUsd.value === null) return false
    return enteredUsd.value >= totalUsd.value - 0.001
  })

  // A valid split leg: any positive cash/card amount. Overpayment on a cash leg is
  // capped to the remaining and the surplus becomes change (handled in buildEntry).
  const canAddLeg = computed(() => {
    if (method.value !== 'cash_usd' && method.value !== 'cash_syp' && method.value !== 'card') return false
    if (enteredUsd.value === null) return false
    return enteredUsd.value > 0.001 && remainingUsd.value > 0.001
  })

  const isReadyToConfirm = computed(() =>
    pendingPayments.value.length > 0 && remainingUsd.value < 0.001
  )

  // Build a payment entry, capping the applied amount at what is still owed.
  // amountUsd holds the NET amount applied to the sale (so it sums to the total);
  // any cash surplus is returned as changeDue in the entry's native currency.
  function buildEntry(
    m: 'cash_usd' | 'cash_syp' | 'card',
    amountRaw: number,
    remaining: number,
    rate: number,
  ): SplitPaymentEntry {
    const currency: 'USD' | 'SYP' = m === 'cash_syp' ? 'SYP' : 'USD'
    const grossUsd   = m === 'cash_syp' ? amountRaw / rate : amountRaw
    const appliedUsd = Math.min(grossUsd, remaining)
    const overUsd    = grossUsd - appliedUsd

    // Card is charged for the exact applied amount — never any change.
    if (m === 'card' || overUsd <= 0.001) {
      return { method: m, amountRaw, currency, amountUsd: appliedUsd, exchangeRate: rate, changeDue: 0 }
    }

    const changeNative = currency === 'SYP' ? Math.round(overUsd * rate) : round2(overUsd)
    const netRaw       = currency === 'SYP' ? Math.round(appliedUsd * rate) : round2(appliedUsd)
    return { method: m, amountRaw: netRaw, currency, amountUsd: appliedUsd, exchangeRate: rate, changeDue: changeNative }
  }

  function selectMethod(m: PaymentMethod) {
    method.value = m
    state.value  = m === 'card'   ? 'card-confirm'
                 : m === 'credit' ? 'credit-confirm'
                 : 'amount-entry'
  }

  function back() {
    if (state.value === 'amount-entry' || state.value === 'card-confirm' || state.value === 'credit-confirm') {
      amountReceived.value = null
      method.value         = null
      state.value          = 'method-selection'
    }
  }

  function cancel() {
    isOpen.value          = false
    pendingPayments.value = []
  }

  function addPayment(m: 'cash_usd' | 'cash_syp' | 'card', amountRaw: number) {
    const rate = saleStore.lockedExchangeRate ?? 1
    pendingPayments.value = [
      ...pendingPayments.value,
      buildEntry(m, amountRaw, remainingUsd.value, rate),
    ]
  }

  function removeLastPayment() {
    if (pendingPayments.value.length > 0) {
      pendingPayments.value = pendingPayments.value.slice(0, -1)
    }
  }

  async function confirm(customerId?: string): Promise<CompletedSale> {
    if (!method.value && pendingPayments.value.length === 0) throw new Error('No payment selected')
    state.value  = 'confirming'
    error.value  = null

    const saleId     = uuidv4()
    const now        = new Date().toISOString()
    const displayNum = nextNumber()

    // A credit (آجل) sale is unpaid — it must NOT record any tendered payment.
    const isCredit = method.value === 'credit' && pendingPayments.value.length === 0

    // Build entries list
    let entries: SplitPaymentEntry[]
    if (isCredit) {
      entries = []
    } else if (pendingPayments.value.length > 0) {
      entries = pendingPayments.value
    } else {
      const rate   = saleStore.lockedExchangeRate ?? 1
      const m      = method.value as 'cash_usd' | 'cash_syp' | 'card'
      const rawAmt = amountReceived.value ?? totalUsd.value
      entries = [buildEntry(m, rawAmt, totalUsd.value, rate)]
    }

    const isSplit       = entries.length > 1
    const primaryMethod: PaymentMethod =
      isCredit ? 'credit' : isSplit ? 'split' : entries[0].method
    const totalReceived = entries.reduce((s, e) => s + e.amountUsd, 0)
    const lastChange    = entries.length > 0 ? entries[entries.length - 1].changeDue : 0

    const sale: CompletedSale = {
      saleId,
      displaySaleNumber:      displayNum,
      totalUsd:               totalUsd.value,
      totalSyp:               totalSyp.value,
      exchangeRateAtSale:     saleStore.lockedExchangeRate!,
      paymentMethod:          primaryMethod,
      amountReceived:         totalReceived,
      amountReceivedCurrency: 'USD',
      changeDue:              lastChange || undefined,
      createdAt:              now,
      customerId,
      splitPayments:          isSplit ? entries : undefined,
      lines:                  saleStore.lines.map(l => ({
        nameAr:       l.nameAr,
        quantity:     l.quantity,
        unitPriceUsd: l.unitPriceUsd,
        lineTotalUsd: l.lineTotalUsd,
      })),
    }

    try {
      // All writes for one sale run in a single transaction so a mid-way failure
      // can't leave a sale row without its line items, payments, or stock movements.
      await db.writeTransaction(async (tx) => {
        await tx.execute(
          `INSERT INTO sales (id, shop_id, device_id, device_sequence, display_sale_number,
            created_at, total_usd, total_syp, exchange_rate_at_sale, payment_method,
            amount_received, amount_received_currency, change_due, customer_id, is_credit, is_split, shift_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            saleId, deviceStore.shopId, deviceStore.deviceId,
            saleStore.deviceSequence, displayNum, now,
            totalUsd.value, totalSyp.value, saleStore.lockedExchangeRate,
            primaryMethod, totalReceived, 'USD', lastChange || null,
            customerId ?? null, isCredit ? 1 : 0, isSplit ? 1 : 0,
            shiftStore.activeShiftId,
          ]
        )

        // Insert one row per payment entry into sale_payments
        for (const entry of entries) {
          await tx.execute(
            `INSERT INTO sale_payments (id, sale_id, shop_id, method, amount_raw, currency,
              amount_usd, exchange_rate, change_due, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              uuidv4(), saleId, deviceStore.shopId, entry.method, entry.amountRaw,
              entry.currency, entry.amountUsd, entry.exchangeRate,
              entry.changeDue || null, now,
            ]
          )
        }

        for (const line of saleStore.lines) {
          const res = await tx.execute(
            'SELECT cost_price_usd, current_stock FROM products WHERE id = ?',
            [line.productId]
          )
          const row          = (res as any).rows?._array?.[0]
          const unitCostUsd  = row?.cost_price_usd ?? 0
          const currentStock = row?.current_stock ?? 0
          const newStock     = currentStock - line.quantity

          await tx.execute(
            `INSERT INTO sale_line_items (id, sale_id, shop_id, product_id, quantity, unit_price_usd, unit_cost_usd, line_total_usd)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [uuidv4(), saleId, deviceStore.shopId, line.productId,
             line.quantity, line.unitPriceUsd, unitCostUsd, line.lineTotalUsd]
          )
          await tx.execute(
            `UPDATE products SET current_stock = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
            [newStock, now, line.productId]
          )
          await tx.execute(
            `INSERT INTO stock_adjustments (id, shop_id, product_id, old_value, new_value, reason, notes, created_at, device_id)
             VALUES (?, ?, ?, ?, ?, 'sale', null, ?, ?)`,
            [uuidv4(), deviceStore.shopId, line.productId, currentStock, newStock, now, deviceStore.deviceId]
          )
        }
        // Log the sale completion inside the transaction for atomicity
        await tx.execute(
          `INSERT INTO audit_log
             (id, shop_id, staff_id, staff_name, event, entity_type, entity_id, meta, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            uuidv4(),
            deviceStore.shopId,
            null,
            'system',
            'sale.completed',
            'sale',
            saleId,
            JSON.stringify({ totalUsd: sale.totalUsd, itemCount: sale.lines.length }),
            now,
          ]
        )
      })

      await clearDraft()
      saleStore.clear()
      pendingPayments.value = []
      state.value           = 'confirmed'
      isOpen.value          = false
      return sale
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Payment failed'
      state.value = method.value === 'card'   ? 'card-confirm'
                  : method.value === 'credit' ? 'credit-confirm'
                  : 'amount-entry'
      throw err
    }
  }

  return {
    state, isOpen, method, amountReceived, error,
    totalUsd, totalSyp, changeDue, enteredUsd,
    pendingPayments, paidUsd, remainingUsd, isReadyToConfirm,
    canConfirmSingle, canAddLeg,
    selectMethod, back, cancel, confirm,
    addPayment, removeLastPayment,
  }
}
