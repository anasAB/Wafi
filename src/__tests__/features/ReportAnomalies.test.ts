import { describe, it, expect } from 'vitest'
import { evaluateReportAnomalies } from '@/features/dashboard/composables/useReportAnomalies'

describe('evaluateReportAnomalies', () => {
  it('flags high expenses when expenses are above 30% of gross', () => {
    const r = evaluateReportAnomalies(1000, 400, 50)
    expect(r.highExpenses).toBe(true)
    expect(r.highReturns).toBe(false)
  })

  it('flags high returns when returns are above 10% of gross', () => {
    const r = evaluateReportAnomalies(1000, 50, 150)
    expect(r.highExpenses).toBe(false)
    expect(r.highReturns).toBe(true)
  })

  it('stays silent below the minimum revenue floor', () => {
    const r = evaluateReportAnomalies(20, 19, 0)
    expect(r.highExpenses).toBe(false)
    expect(r.highReturns).toBe(false)
  })

  it('stays silent in clean periods', () => {
    const r = evaluateReportAnomalies(1000, 200, 50)
    expect(r.highExpenses).toBe(false)
    expect(r.highReturns).toBe(false)
  })
})
