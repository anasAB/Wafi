import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/data/powersync/db', () => import('@/../src/__tests__/__mocks__/db'))

import SalePanel from '@/features/pos/SalePanel.vue'
import { useSaleStore } from '@/store/sale.store'

function dispatchPointer(
  element: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  payload: { pointerId: number; pointerType: string; clientX: number; clientY: number }
) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    pointerId: { value: payload.pointerId },
    pointerType: { value: payload.pointerType },
    clientX: { value: payload.clientX },
    clientY: { value: payload.clientY },
    button: { value: 0 },
  })
  element.dispatchEvent(event)
}

describe('SalePanel swipe-to-remove (Task 12)', () => {
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    localStorage.clear()
  })

  function seedLine() {
    const store = useSaleStore()
    store.addLine({
      productId: 'p1',
      nameAr: 'منتج تجريبي',
      quantity: 1,
      unitPriceUsd: 10,
      lineTotalUsd: 10,
      availableStock: 99,
    })
    return store
  }

  function mountPanel() {
    return mount(SalePanel, {
      global: {
        plugins: [pinia],
      },
    })
  }

  it('removes line on a clear left swipe beyond threshold', async () => {
    const store = seedLine()
    const wrapper = mountPanel()

    const row = wrapper.get('[data-testid="sale-line-p1"]').element
    dispatchPointer(row, 'pointerdown', { pointerId: 1, pointerType: 'touch', clientX: 220, clientY: 40 })
    dispatchPointer(row, 'pointermove', { pointerId: 1, pointerType: 'touch', clientX: 130, clientY: 44 })
    dispatchPointer(row, 'pointerup', { pointerId: 1, pointerType: 'touch', clientX: 130, clientY: 44 })

    expect(store.lines).toHaveLength(0)
  })

  it('does not remove line on short accidental swipe', async () => {
    const store = seedLine()
    const wrapper = mountPanel()

    const row = wrapper.get('[data-testid="sale-line-p1"]').element
    dispatchPointer(row, 'pointerdown', { pointerId: 2, pointerType: 'touch', clientX: 220, clientY: 40 })
    dispatchPointer(row, 'pointermove', { pointerId: 2, pointerType: 'touch', clientX: 185, clientY: 42 })
    dispatchPointer(row, 'pointerup', { pointerId: 2, pointerType: 'touch', clientX: 185, clientY: 42 })

    expect(store.lines).toHaveLength(1)
  })

  it('keeps the × delete button behavior as fallback', async () => {
    const store = seedLine()
    const wrapper = mountPanel()

    await wrapper.get('[data-testid="line-delete-p1"]').trigger('click')

    expect(store.lines).toHaveLength(0)
  })
})
