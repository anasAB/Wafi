import { ref, computed } from 'vue'
import { useSaleStore } from '@/store/sale.store'
import { useSaleDraft } from '@/composables/useSaleDraft'
import { useDeviceStore } from '@/store/device.store'
import { useShiftStore } from '@/features/shifts/shift.store'
import { useSessionStore } from '@/store/session.store'
import { useAuditLog } from '@/features/audit/composables/useAuditLog'
import { completeSale } from '@/services/sales.service'
import type { PaymentMethod, PaymentState, CompletedSale, SplitPaymentEntry } from './payment.types'

export function usePayment() {
  const saleStore      = useSaleStore()
  const deviceStore    = useDeviceStore()
  const shiftStore     = useShiftStore()
  const sessionStore   = useSessionStore()
  const { clearDraft } = useSaleDraft()
  const { logSaleCompleted, logDiscountApplied } = useAuditLog()

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
    state.value  = m === 'card'        ? 'card-confirm'
                 : m === 'credit'      ? 'credit-confirm'
                 : m === 'installment' ? 'installment-confirm'
                 : 'amount-entry'
  }

  function back() {
    if (
      state.value === 'amount-entry' || state.value === 'card-confirm' ||
      state.value === 'credit-confirm' || state.value === 'installment-confirm'
    ) {
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
    // WAFI-203: a sale must always be attributable to a real operator — this
    // is the last line of defense before the write, matching the fail-closed
    // pattern already used by auth_permissions()/can() server-side. Both
    // openShift and switchTo now require server-confirmed identity before
    // setting this, so reaching here with no active operator means some
    // other code path skipped that gate.
    if (!sessionStore.activeStaff) throw new Error('No active operator — cannot complete sale')
    // Idempotency guard (WAFI-003): a confirm already in flight must not start a
    // second sale. Without this, a rapid double-tap or a held Enter writes a
    // duplicate sale row and burns a second receipt number. The catch path below
    // resets state, so a retry after a genuine failure is still allowed.
    if (state.value === 'confirming') throw new Error('Sale is already being confirmed')
    if (!method.value && pendingPayments.value.length === 0) throw new Error('No payment selected')
    state.value  = 'confirming'
    error.value  = null

    try {
      const sale = await completeSale(
        {
          shopId: deviceStore.shopId,
          deviceId: deviceStore.deviceId,
          deviceCode: deviceStore.deviceCode,
          staffId: sessionStore.activeStaff?.id ?? null,
          shiftId: shiftStore.activeShiftId,
          // Claim this sale's sequence number but DON'T persist the advance yet
          // (WAFI-004): the service reads deviceSequence to compute the number,
          // and incrementSequence() below runs only after it resolves — a
          // failed write therefore leaves the sequence intact so the next sale
          // reuses this number.
          deviceSequence: saleStore.deviceSequence,
          method: method.value,
          amountReceived: amountReceived.value,
          pendingPayments: pendingPayments.value,
          customerId,
          totalUsd: totalUsd.value,
          totalSyp: totalSyp.value,
          exchangeRateAtSale: saleStore.lockedExchangeRate!,
          lines: saleStore.lines,
          saleDiscount: saleStore.saleDiscount,
        },
        { logSaleCompleted, logDiscountApplied },
      )

      // Write succeeded — only now commit the sequence advance (WAFI-004).
      saleStore.incrementSequence()
      await clearDraft()
      saleStore.clear()
      pendingPayments.value = []
      state.value           = 'confirmed'
      isOpen.value          = false
      return sale
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Payment failed'
      state.value = method.value === 'card'        ? 'card-confirm'
                  : method.value === 'credit'      ? 'credit-confirm'
                  : method.value === 'installment' ? 'installment-confirm'
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
