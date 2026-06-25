import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { i18n } from '@/i18n'
import CashMovementsList from '@/features/shifts/components/CashMovementsList.vue'
import type { CashMovement } from '@/features/shifts/cashMovement.types'

const base: Omit<CashMovement, 'id' | 'direction' | 'category' | 'voidsMovementId'> = {
  shopId: 's', deviceId: 'd', shiftId: 'shift-1', staffId: 'st',
  currency: 'USD', amount: 80, note: null, createdAt: 'x',
}
const original: CashMovement = { ...base, id: 'm-1', direction: 'out', category: 'paid_supplier', voidsMovementId: null }
const voidRow:  CashMovement = { ...base, id: 'v-1', direction: 'in',  category: 'paid_supplier', voidsMovementId: 'm-1' }

function mountList(props: { movements: CashMovement[]; canVoid?: boolean }) {
  return mount(CashMovementsList, {
    props: { canVoid: true, ...props },
    global: { plugins: [i18n] },
  })
}

describe('CashMovementsList', () => {
  it('renders a movement with its category label', () => {
    const w = mountList({ movements: [original] })
    expect(w.text()).toContain('دفع لمورد')
  })

  it('shows the void button for a live original and emits void with its id', async () => {
    const w = mountList({ movements: [original] })
    await w.get('[data-test="void-m-1"]').trigger('click')
    expect(w.emitted('void')![0][0]).toBe('m-1')
  })

  it('marks a reversed original as voided and hides its void button', () => {
    const w = mountList({ movements: [original, voidRow] })
    expect(w.get('[data-test="row-m-1"]').classes()).toContain('voided')
    expect(w.find('[data-test="void-m-1"]').exists()).toBe(false)
  })

  it('never shows a void button on a void row', () => {
    const w = mountList({ movements: [original, voidRow] })
    expect(w.find('[data-test="void-v-1"]').exists()).toBe(false)
  })

  it('hides all void buttons when canVoid is false', () => {
    const w = mountList({ movements: [original], canVoid: false })
    expect(w.find('[data-test="void-m-1"]').exists()).toBe(false)
  })
})
