import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import PaymentModal from '@/features/payment/PaymentModal.vue'
import { useSaleStore } from '@/store/sale.store'

function mountModal() {
  const pinia = createPinia()
  pinia.use(piniaPluginPersistedstate)
  setActivePinia(pinia)

  // Seed a sale so the amount-entry screen has a total to work against.
  const store = useSaleStore()
  store.clear()
  store.addLine({ productId: 'p1', nameAr: 'منتج', quantity: 1, unitPriceUsd: 10, lineTotalUsd: 10, availableStock: 99 })
  store.setLockedRate(14500)

  return mount(PaymentModal, { global: { plugins: [pinia] } })
}

async function enterAmountEntry(w: ReturnType<typeof mountModal>) {
  // First method tile is "نقدي دولار" (cash_usd) → moves to amount-entry.
  await w.findAll('.method-tile')[0].trigger('click')
}

function press(key: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }))
}

describe('PaymentModal — physical keyboard in amount entry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('types digits from the physical keyboard into the amount', async () => {
    const w = mountModal()
    await enterAmountEntry(w)

    press('1'); press('2'); press('5')
    await w.vm.$nextTick()

    expect(w.find('.amount-input-value').text()).toBe('125')
  })

  it('supports the decimal point and Backspace', async () => {
    const w = mountModal()
    await enterAmountEntry(w)

    press('9'); press('.'); press('5'); press('0')
    await w.vm.$nextTick()
    expect(w.find('.amount-input-value').text()).toBe('9.50')

    press('Backspace')
    await w.vm.$nextTick()
    expect(w.find('.amount-input-value').text()).toBe('9.5')
  })

  it('ignores keystrokes before a cash method is selected', async () => {
    const w = mountModal()
    // Still on method-selection — there is no amount field yet.
    press('7')
    await w.vm.$nextTick()
    expect(w.find('.amount-input-value').exists()).toBe(false)
  })

  it('removes the keydown listener when unmounted', async () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const w = mountModal()
    w.unmount()
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
    removeSpy.mockRestore()
  })
})

describe('PaymentModal — credit sale requires a customer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('disables "تأكيد البيع الآجل" until a customer is chosen and never emits without one', async () => {
    const w = mountModal()
    // Choose the آجل (credit) method.
    await w.find('[data-testid="credit-method-btn"]').trigger('click')

    // No customer selected yet → confirm is disabled, and a "pick customer" CTA is shown.
    const confirmBtn = w.find('[data-testid="confirm-credit-btn"]')
    expect(confirmBtn.exists()).toBe(true)
    expect(confirmBtn.attributes('disabled')).toBeDefined()
    expect(w.find('[data-testid="pick-credit-customer-btn"]').exists()).toBe(true)

    // Even if clicked, no sale is completed.
    await confirmBtn.trigger('click')
    expect(w.emitted('confirmed')).toBeFalsy()
  })
})
