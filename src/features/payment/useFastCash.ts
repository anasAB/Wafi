import { ref } from 'vue'
import { useSaleStore } from '@/store/sale.store'
import { usePayment } from './usePayment'
import type { CompletedSale } from './payment.types'

/**
 * WAFI-124: one-tap exact-cash tender. Drives the EXISTING usePayment.confirm
 * with an exact amount in the chosen currency — no forked payment path, so the
 * sale and its single `sale_payments` leg are byte-identical in shape to the
 * modal's cash flow (zero change, same guards: rate lock, stock, sequence).
 *
 * A fresh usePayment instance is built per tap, so the modal's per-instance
 * confirming guard doesn't apply — `busy` is this flow's own double-tap guard.
 */
export function useFastCash() {
  const saleStore = useSaleStore()
  const busy = ref(false)

  async function payExactCash(currency: 'USD' | 'SYP'): Promise<CompletedSale | null> {
    if (busy.value) return null
    if (saleStore.lines.length === 0 || saleStore.totalUsd <= 0) return null
    const rate = saleStore.lockedExchangeRate
    if (currency === 'SYP' && rate === null) return null // no rate → no SYP total to tender

    busy.value = true
    try {
      const payment = usePayment()
      payment.selectMethod(currency === 'USD' ? 'cash_usd' : 'cash_syp')
      // Exact tender in the native currency (SYP totals follow the existing
      // whole-number display convention: round once here, like the modal).
      payment.amountReceived.value = currency === 'USD'
        ? saleStore.totalUsd
        : Math.round(saleStore.totalUsd * (rate as number))
      return await payment.confirm()
    } finally {
      busy.value = false
    }
  }

  return { busy, payExactCash }
}
