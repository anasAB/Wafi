import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import DenominationTally from '../DenominationTally.vue'

describe('DenominationTally', () => {
  it('tally mode: total is the sum of value×count, breakdown reflects the counts', async () => {
    const wrapper = mount(DenominationTally, {
      props: { label: 'SYP', denominations: [1000, 5000], isSyp: true },
    })
    await wrapper.get('[data-testid="denom-row-syp-1000"] .step-btn:last-child').trigger('click')
    await wrapper.get('[data-testid="denom-row-syp-1000"] .step-btn:last-child').trigger('click')
    await wrapper.get('[data-testid="denom-row-syp-5000"] .step-btn:last-child').trigger('click')

    const events = wrapper.emitted('change')!
    const last = events[events.length - 1][0] as { total: number; breakdown: Record<string, number> | null }
    expect(last.total).toBe(1000 * 2 + 5000 * 1)
    expect(last.breakdown).toEqual({ '1000': 2, '5000': 1 })
  })

  it('switching to manual mode clears the tally counts, and vice versa — the two never coexist', async () => {
    const wrapper = mount(DenominationTally, {
      props: { label: 'USD', denominations: [10, 20], isSyp: false },
    })
    await wrapper.get('[data-testid="denom-row-usd-10"] .step-btn:last-child').trigger('click')

    const buttons = wrapper.findAll('.mode-btn')
    await buttons[1].trigger('click') // switch to manual
    await wrapper.get('.manual-input').setValue('55')

    let last = wrapper.emitted('change')!.at(-1)![0] as { total: number; breakdown: Record<string, number> | null }
    expect(last.total).toBe(55)
    expect(last.breakdown).toBeNull() // manual mode never emits a contradicting breakdown

    await buttons[0].trigger('click') // switch back to tally
    last = wrapper.emitted('change')!.at(-1)![0] as { total: number; breakdown: Record<string, number> | null }
    expect(last.total).toBe(0) // counts were reset when manual mode was entered
    expect(last.breakdown).toEqual({ '10': 0, '20': 0 })
  })

  it('breakdown sum always equals the emitted total (never drifts)', async () => {
    const wrapper = mount(DenominationTally, {
      props: { label: 'SYP', denominations: [500, 1000, 2000], isSyp: true },
    })
    await wrapper.get('[data-testid="denom-row-syp-500"] .step-btn:last-child').trigger('click')
    await wrapper.get('[data-testid="denom-row-syp-2000"] .step-btn:last-child').trigger('click')
    await wrapper.get('[data-testid="denom-row-syp-2000"] .step-btn:last-child').trigger('click')

    const last = wrapper.emitted('change')!.at(-1)![0] as { total: number; breakdown: Record<string, number> | null }
    const breakdownSum = Object.entries(last.breakdown!).reduce((sum, [v, c]) => sum + Number(v) * c, 0)
    expect(breakdownSum).toBe(last.total)
  })
})
