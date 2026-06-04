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

  const changeDue = computed(() => {
    if (method.value === 'cash_usd' && amountReceived.value !== null) {
      return Math.max(0, amountReceived.value - totalUsd.value)
    }
    if (method.value === 'cash_syp' && amountReceived.value !== null) {
      return Math.max(0, amountReceived.value - totalSyp.value)
    }
    return null
  })

  // Split computeds
  const paidUsd = computed(() =>
    pendingPayments.value.reduce((s, p) => s + p.amountUsd, 0)
  )

  const remainingUsd = computed(() =>
    Math.max(0, totalUsd.value - paidUsd.value)
  )

  const isReadyToConfirm = computed(() =>
    pendingPayments.value.length > 0 && remainingUsd.value < 0.001
  )

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
    const rate      = saleStore.lockedExchangeRate ?? 1
    const currency  = m === 'cash_syp' ? 'SYP' as const : 'USD' as const
    const amountUsd = m === 'cash_syp' ? amountRaw / rate : amountRaw
    pendingPayments.value = [
      ...pendingPayments.value,
      { method: m, amountRaw, currency, amountUsd, exchangeRate: rate, changeDue: 0 },
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

    // Build entries list
    let entries: SplitPaymentEntry[]
    if (pendingPayments.value.length > 0) {
      entries = pendingPayments.value
    } else {
      const rate   = saleStore.lockedExchangeRate ?? 1
      const m      = method.value as 'cash_usd' | 'cash_syp' | 'card'
      const rawAmt = amountReceived.value ?? totalUsd.value
      const amtUsd = m === 'cash_syp' ? rawAmt / rate : rawAmt
      entries = [{
        method:       m,
        amountRaw:    rawAmt,
        currency:     m === 'cash_syp' ? 'SYP' : 'USD',
        amountUsd:    amtUsd,
        exchangeRate: rate,
        changeDue:    changeDue.value ?? 0,
      }]
    }

    const isSplit       = entries.length > 1
    const primaryMethod = isSplit ? 'split' as const : entries[0].method
    const totalReceived = entries.reduce((s, e) => s + e.amountUsd, 0)
    const lastChange    = entries[entries.length - 1].changeDue

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
      await db.execute(
        `INSERT INTO sales (id, shop_id, device_id, device_sequence, display_sale_number,
          created_at, total_usd, total_syp, exchange_rate_at_sale, payment_method,
          amount_received, amount_received_currency, change_due, customer_id, is_credit, is_split, shift_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          saleId, deviceStore.shopId, deviceStore.deviceId,
          saleStore.deviceSequence, displayNum, now,
          totalUsd.value, totalSyp.value, saleStore.lockedExchangeRate,
          primaryMethod, totalReceived, 'USD', lastChange ?? null,
          customerId ?? null, customerId ? 1 : 0, isSplit ? 1 : 0,
          shiftStore.activeShiftId,
        ]
      )

      // Insert one row per payment entry into sale_payments
      for (const entry of entries) {
        await db.execute(
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
        const costRow = await db.getOptional<{ cost_price_usd: number }>(
          'SELECT cost_price_usd FROM products WHERE id = ?',
          [line.productId]
        )
        const unitCostUsd = costRow?.cost_price_usd ?? 0

        await db.execute(
          `INSERT INTO sale_line_items (id, sale_id, shop_id, product_id, quantity, unit_price_usd, unit_cost_usd, line_total_usd)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [uuidv4(), saleId, deviceStore.shopId, line.productId,
           line.quantity, line.unitPriceUsd, unitCostUsd, line.lineTotalUsd]
        )
      }

      for (const line of saleStore.lines) {
        const stockRow = await db.getOptional<{ current_stock: number }>(
          `SELECT current_stock FROM products WHERE id = ?`,
          [line.productId]
        )
        const currentStock = stockRow?.current_stock ?? 0
        const newStock     = currentStock - line.quantity

        await db.execute(
          `UPDATE products SET current_stock = ?, updated_at = ?, sync_status = 'pending' WHERE id = ?`,
          [newStock, now, line.productId]
        )
        await db.execute(
          `INSERT INTO stock_adjustments (id, shop_id, product_id, old_value, new_value, reason, notes, created_at, device_id)
           VALUES (?, ?, ?, ?, ?, 'sale', null, ?, ?)`,
          [uuidv4(), deviceStore.shopId, line.productId, currentStock, newStock, now, deviceStore.deviceId]
        )
      }

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
    totalUsd, totalSyp, changeDue,
    pendingPayments, paidUsd, remainingUsd, isReadyToConfirm,
    selectMethod, back, cancel, confirm,
    addPayment, removeLastPayment,
  }
}
