import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { i18n } from '@/i18n'   // shared instance, as other component tests use
import RecordCashMovementSheet from '@/features/shifts/components/RecordCashMovementSheet.vue'

function mountSheet(props = {}) {
  return mount(RecordCashMovementSheet, {
    props: { liveDrawerUsd: 250, liveDrawerSyp: 1_000_000, ...props },
    global: { plugins: [i18n] },
  })
}

describe('RecordCashMovementSheet', () => {
  it('shows only out-direction categories when direction is out', async () => {
    const w = mountSheet()
    // default direction 'out'
    expect(w.text()).toContain('دفع لمورد')
    expect(w.text()).toContain('إيداع للخزنة')
    expect(w.text()).not.toContain('تغذية الصندوق') // an 'in' category
  })

  it('switches category set when direction toggles to in', async () => {
    const w = mountSheet()
    await w.get('[data-test="dir-in"]').trigger('click')
    expect(w.text()).toContain('تغذية الصندوق')
    expect(w.text()).not.toContain('دفع لمورد')
  })

  it('shows an overdraw warning when amount exceeds the drawer, but still allows confirm', async () => {
    const w = mountSheet({ liveDrawerUsd: 250 })
    await w.get('[data-test="cat-paid_supplier"]').trigger('click')
    await w.get('[data-test="amount"]').setValue('300') // > 250
    expect(w.get('[data-test="overdraw-warning"]').exists()).toBe(true)
    expect((w.get('[data-test="confirm"]').element as HTMLButtonElement).disabled).toBe(false)
  })

  it('emits record with the chosen fields on confirm', async () => {
    const w = mountSheet()
    await w.get('[data-test="cat-drop_to_safe"]').trigger('click')
    await w.get('[data-test="amount"]').setValue('80')
    await w.get('[data-test="confirm"]').trigger('click')
    const ev = w.emitted('record')
    expect(ev).toBeTruthy()
    expect(ev![0][0]).toMatchObject({
      direction: 'out', category: 'drop_to_safe', currency: 'USD', amount: 80,
    })
  })

  it('rejects a non-integer SYP amount (confirm disabled / no emit)', async () => {
    const w = mountSheet()
    await w.get('[data-test="cur-SYP"]').trigger('click')
    await w.get('[data-test="cat-drop_to_safe"]').trigger('click')
    await w.get('[data-test="amount"]').setValue('100.5')
    await w.get('[data-test="confirm"]').trigger('click')
    expect(w.emitted('record')).toBeFalsy()
  })
})
