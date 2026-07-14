import { describe, it, expect } from 'vitest'
import { generateInstallmentSchedule } from '@/features/installments/installmentSchedule'

describe('generateInstallmentSchedule', () => {
  it('splits the financed amount evenly across monthly terms', () => {
    const schedule = generateInstallmentSchedule(300, 0, 3, 'monthly', '2026-08-01')
    expect(schedule).toHaveLength(3)
    expect(schedule[0]).toEqual({ dueDate: '2026-08-01', amountDueUsd: 100 })
    expect(schedule[1]).toEqual({ dueDate: '2026-09-01', amountDueUsd: 100 })
    expect(schedule[2]).toEqual({ dueDate: '2026-10-01', amountDueUsd: 100 })
  })

  it('subtracts the down payment before splitting', () => {
    const schedule = generateInstallmentSchedule(300, 60, 3, 'monthly', '2026-08-01')
    const sum = schedule.reduce((s, d) => s + d.amountDueUsd, 0)
    expect(Math.round(sum * 100) / 100).toBe(240)
  })

  it('absorbs rounding remainder into the last installment', () => {
    // financed = 100, 3 terms -> 33.33 + 33.33 + 33.34
    const schedule = generateInstallmentSchedule(100, 0, 3, 'monthly', '2026-08-01')
    expect(schedule[0].amountDueUsd).toBe(33.33)
    expect(schedule[1].amountDueUsd).toBe(33.33)
    expect(schedule[2].amountDueUsd).toBe(33.34)
    const sum = schedule.reduce((s, d) => s + d.amountDueUsd, 0)
    expect(Math.round(sum * 100) / 100).toBe(100)
  })

  it('steps weekly due dates by 7 days', () => {
    const schedule = generateInstallmentSchedule(200, 0, 2, 'weekly', '2026-08-01')
    expect(schedule[0].dueDate).toBe('2026-08-01')
    expect(schedule[1].dueDate).toBe('2026-08-08')
  })

  it('throws for a non-positive term_count', () => {
    expect(() => generateInstallmentSchedule(100, 0, 0, 'monthly', '2026-08-01')).toThrow()
  })
})
