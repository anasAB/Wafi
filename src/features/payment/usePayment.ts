import { ref, computed } from 'vue'
import { useSaleStore } from '@/store/sale.store'
import { useSaleNumber } from '@/composables/useSaleNumber'
import { useSaleDraft } from '@/composables/useSaleDraft'
import { db } from '@/data/powersync/db'
import { useDeviceStore } from '@/store/device.store'
import { v4 as uuidv4 } from 'uuid'
import type { PaymentMethod, PaymentState, CompletedSale } from './payment.types'

export function usePayment() {
  const saleStore   = useSaleStore()
  const deviceStore = useDeviceStore()
  const state       = ref<PaymentState>('method-selection')
  const isOpen      = ref(true)
  const method      = ref<PaymentMethod | null>(null)
  const amountReceived = ref<number | null>(null)
  const confirming  = ref(false)
  const error       = ref<string | null>(null)

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

  function selectMethod(m: PaymentMethod) {
    method.value = m
    if (m === 'card') {
      state.value = 'confirming'
    } else {
      state.value = 'amount-entry'
    }
  }

  function back() {
    if (state.value === 'amount-entry') {
      amountReceived.value = null
      state.value = 'method-selection'
    }
  }

  function cancel() {
    isOpen.value = false
    // Sale intentionally NOT cleared — user can resume
  }

  async function confirm(): Promise<CompletedSale> {
    if (!method.value) throw new Error('No payment method selected')
    confirming.value = true
    error.value      = null

    const saleId     = uuidv4()
    const now        = new Date().toISOString()
    const { nextNumber } = useSaleNumber()
    const displayNum = nextNumber()

    const sale: CompletedSale = {
      saleId,
      displaySaleNumber:      displayNum,
      totalUsd:               totalUsd.value,
      totalSyp:               totalSyp.value,
      exchangeRateAtSale:     saleStore.lockedExchangeRate!,
      paymentMethod:          method.value,
      amountReceived:         amountReceived.value ?? undefined,
      amountReceivedCurrency: method.value === 'cash_syp' ? 'SYP' : 'USD',
      changeDue:              changeDue.value ?? undefined,
      createdAt:              now,
    }

    try {
      await db.execute(
        `INSERT INTO sales (id, shop_id, device_id, device_sequence, display_sale_number,
          created_at, total_usd, total_syp, exchange_rate_at_sale, payment_method,
          amount_received, amount_received_currency, change_due)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          saleId, deviceStore.shopId, deviceStore.deviceId,
          saleStore.deviceSequence, displayNum, now,
          totalUsd.value, totalSyp.value, sale.exchangeRateAtSale,
          method.value, sale.amountReceived ?? null,
          sale.amountReceivedCurrency ?? null, sale.changeDue ?? null,
        ]
      )

      for (const line of saleStore.lines) {
        await db.execute(
          `INSERT INTO sale_line_items (id, sale_id, shop_id, product_id, quantity, unit_price_usd, line_total_usd)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [uuidv4(), saleId, deviceStore.shopId, line.productId,
           line.quantity, line.unitPriceUsd, line.lineTotalUsd]
        )
      }

      const { clearDraft } = useSaleDraft()
      await clearDraft()
      saleStore.clear()
      state.value  = 'confirmed'
      isOpen.value = false
      return sale
    } catch (err) {
      error.value      = err instanceof Error ? err.message : 'Payment failed'
      confirming.value = false
      throw err
    }
  }

  return {
    state, isOpen, method, amountReceived, confirming, error,
    totalUsd, totalSyp, changeDue,
    selectMethod, back, cancel, confirm,
  }
}
