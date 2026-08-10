import { describe, it, expect } from 'vitest'
import { evaluateRevenue, evaluateProfit } from '../evaluateInsight'

describe('evaluateRevenue', () => {
  it('generates an "up" insight when both thresholds are met', () => {
    const result = evaluateRevenue(115, 100, false)
    expect(result).toEqual({ metric: 'revenue', direction: 'up', currentUsd: 115, previousUsd: 100, percentChange: 15 })
  })

  it('generates a "down" insight when both thresholds are met', () => {
    const result = evaluateRevenue(85, 100, false)
    expect(result).toEqual({ metric: 'revenue', direction: 'down', currentUsd: 85, previousUsd: 100, percentChange: -15 })
  })

  it('skips when percent change is below the threshold', () => {
    expect(evaluateRevenue(108, 100, false)).toBeNull()
  })

  it('skips when the dollar change is below the floor even if percent is high', () => {
    expect(evaluateRevenue(6, 4, false)).toBeNull()
  })

  it('skips when the comparison baseline is zero', () => {
    expect(evaluateRevenue(45, 0, false)).toBeNull()
  })

  it('skips when the comparison period is missing', () => {
    expect(evaluateRevenue(450, 500, true)).toBeNull()
  })

  it('generates a "down" insight for an exact 100% drop (current is $0)', () => {
    const result = evaluateRevenue(0, 100, false)
    expect(result).toEqual({ metric: 'revenue', direction: 'down', currentUsd: 0, previousUsd: 100, percentChange: -100 })
  })
})

describe('evaluateProfit', () => {
  it('generates an "up" insight when both periods are profitable and thresholds are met', () => {
    const result = evaluateProfit(130, 100, false, false)
    expect(result).toEqual({ metric: 'profit', direction: 'up', currentUsd: 130, previousUsd: 100, percentChange: 30 })
  })

  it('skips when both are profitable but below the percent threshold', () => {
    expect(evaluateProfit(108, 100, false, false)).toBeNull()
  })

  it('classifies loss -> profit as loss_to_profit with no percentChange', () => {
    const result = evaluateProfit(30, -50, false, false)
    expect(result).toEqual({ metric: 'profit', direction: 'loss_to_profit', currentUsd: 30, previousUsd: -50, percentChange: null })
  })

  it('classifies profit -> loss as profit_to_loss', () => {
    const result = evaluateProfit(-50, 30, false, false)
    expect(result?.direction).toBe('profit_to_loss')
  })

  it('classifies a widening loss as loss_widened', () => {
    const result = evaluateProfit(-70, -20, false, false)
    expect(result?.direction).toBe('loss_widened')
  })

  it('classifies a narrowing loss as loss_narrowed', () => {
    const result = evaluateProfit(-20, -70, false, false)
    expect(result?.direction).toBe('loss_narrowed')
  })

  it('treats a $0 baseline moving to profit as loss_to_profit', () => {
    const result = evaluateProfit(40, 0, false, false)
    expect(result?.direction).toBe('loss_to_profit')
  })

  it('treats a $0 baseline moving to a loss as profit_to_loss', () => {
    const result = evaluateProfit(-40, 0, false, false)
    expect(result?.direction).toBe('profit_to_loss')
  })

  it('skips when the dollar-only change is below the floor', () => {
    expect(evaluateProfit(-48, -50, false, false)).toBeNull()
  })

  it('skips entirely when skipIntraday is true, regardless of thresholds', () => {
    expect(evaluateProfit(30, -50, false, true)).toBeNull()
  })

  it('skips when the comparison period is missing', () => {
    expect(evaluateProfit(130, 100, true, false)).toBeNull()
  })
})
